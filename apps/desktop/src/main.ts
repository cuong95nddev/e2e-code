import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { RotatingFileSink } from "./logging";
import { spawnPty, writePty, resizePty, killPty, killAllPtys } from "./pty-manager";

const BASE_DIR = Path.join(OS.homedir(), ".e2e-code");
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const LOG_DIR = Path.join(STATE_DIR, "logs");
const DESKTOP_SCHEME = "e2e-code";
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;

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
  createWindow();
});

app.on("window-all-closed", () => {
  killAllPtys();
  app.quit();
});

app.on("before-quit", () => {
  killAllPtys();
});
