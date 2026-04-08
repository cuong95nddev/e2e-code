import * as FS from "node:fs";
import * as Http from "node:http";
import * as OS from "node:os";
import * as Path from "node:path";
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, shell } from "electron";
import { RotatingFileSink } from "./logging";
import { spawnPty, writePty, resizePty, killPty, killAllPtys } from "./pty-manager";
import { registerRecorderHandlers } from "./recorder-manager";
import { registerActionCaptureHandlers } from "./action-capture";
import { startChromeBridge, stopChromeBridge, setActiveCwd } from "./chrome-bridge";

const BASE_DIR = Path.join(OS.homedir(), ".e2e-code");
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const LOG_DIR = Path.join(STATE_DIR, "logs");
const DESKTOP_SCHEME = "e2e-code";
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let videoServerPort = 0;

// Local HTTP server for serving recording files with proper Range support.
// Custom Electron protocols (protocol.handle) have unfixable stream lifecycle bugs
// that cause video seeking to break after the first seek.
const videoServer = Http.createServer((req, res) => {
  const filePath = decodeURIComponent((req.url ?? "").replace(/\?.*$/, ""));
  let stat: FS.Stats;
  try { stat = FS.statSync(filePath); }
  catch { res.writeHead(404); res.end(); return; }

  const total = stat.size;
  const mime = filePath.endsWith(".webm") ? "video/webm"
    : filePath.endsWith(".mp4") ? "video/mp4"
    : filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "image/jpeg"
    : filePath.endsWith(".png") ? "image/png"
    : "application/octet-stream";
  const range = req.headers.range;

  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    if (!m) { res.writeHead(416); res.end(); return; }
    const start = parseInt(m[1]!, 10);
    const end = m[2] ? parseInt(m[2]!, 10) : total - 1;
    res.writeHead(206, {
      "Content-Type": mime,
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start + 1),
      "Access-Control-Allow-Origin": "*",
    });
    FS.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(total),
      "Access-Control-Allow-Origin": "*",
    });
    FS.createReadStream(filePath).pipe(res);
  }
});
videoServer.listen(0, "127.0.0.1", () => {
  videoServerPort = (videoServer.address() as { port: number }).port;
});

FS.mkdirSync(LOG_DIR, { recursive: true });
const desktopLog = new RotatingFileSink({ dir: LOG_DIR, prefix: "desktop" });

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  desktopLog.write(line);
  console.log(msg);
}

function registerIpcHandlers(): void {
  // PTY operations
  ipcMain.handle("pty:create", (_event, sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;

    log(`Spawning PTY session=${sessionId} cwd=${cwd} resume=${isResume}`);

    spawnPty(
      sessionId,
      cwd,
      cliSessionId,
      isResume,
      (data) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send("pty:data", sessionId, data);
        }
      },
      (exitCode, signal) => {
        log(`PTY exited session=${sessionId} code=${exitCode} signal=${signal}`);
        const w = BrowserWindow.getAllWindows()[0];
        if (w && !w.isDestroyed()) {
          w.webContents.send("pty:exit", sessionId, exitCode, signal);
        }
      },
    );
  });

  ipcMain.on("pty:write", (_event, sessionId: string, data: string) => {
    writePty(sessionId, data);
  });

  ipcMain.on("pty:resize", (_event, sessionId: string, cols: number, rows: number) => {
    resizePty(sessionId, cols, rows);
  });

  ipcMain.handle("pty:kill", (_event, sessionId: string) => {
    killPty(sessionId);
  });

  // App operations
  ipcMain.handle("app:pickFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("app:openExternal", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.handle("app:getVideoServerPort", () => videoServerPort);
}

function createWindow(): void {
  if (!isDevelopment) {
    protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
      const url = request.url.replace(`${DESKTOP_SCHEME}://app/`, "");
      const filePath = Path.resolve(__dirname, "../../web/dist", url);
      callback({ path: filePath });
    });
  }

  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 800, minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDevelopment) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`${DESKTOP_SCHEME}://app/index.html`);
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  log("App ready, registering IPC handlers");

  registerIpcHandlers();
  registerRecorderHandlers(() => mainWindow);
  registerActionCaptureHandlers();
  startChromeBridge(() => mainWindow);

  // Allow renderer to set the active project cwd for chrome recordings
  ipcMain.handle("chrome:setActiveCwd", (_event, cwd: string) => {
    setActiveCwd(cwd);
  });

  createWindow();
});

app.on("window-all-closed", () => {
  killAllPtys();
  app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", () => {
  killAllPtys();
  stopChromeBridge();
  videoServer.close();
});
