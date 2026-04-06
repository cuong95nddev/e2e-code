import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { RotatingFileSink } from "@claude-desktop/shared/logging";
import { Effect } from "effect";
import { NetService, NetServiceLive } from "@claude-desktop/shared/Net";

const BASE_DIR = Path.join(OS.homedir(), ".claude-desktop");
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const LOG_DIR = Path.join(STATE_DIR, "logs");
const DESKTOP_SCHEME = "claude-desktop";
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";

FS.mkdirSync(LOG_DIR, { recursive: true });
const desktopLog = new RotatingFileSink({ dir: LOG_DIR, prefix: "desktop" });
const backendLog = new RotatingFileSink({ dir: LOG_DIR, prefix: "backend" });

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  desktopLog.write(line);
  console.log(msg);
}

async function startBackend(): Promise<void> {
  backendPort = await Effect.runPromise(
    Effect.gen(function* () {
      const net = yield* NetService;
      return yield* net.findAvailablePort();
    }).pipe(Effect.provide(NetServiceLive))
  ).catch(() => 3100);

  backendAuthToken = Crypto.randomBytes(32).toString("hex");
  backendWsUrl = `ws://127.0.0.1:${backendPort}/ws?token=${backendAuthToken}`;

  const serverEntry = isDevelopment
    ? Path.resolve(__dirname, "../../server/src/bin.ts")
    : Path.resolve(__dirname, "../../server/dist/bin.mjs");

  log(`Starting backend on port ${backendPort}`);

  backendProcess = ChildProcess.spawn(
    process.execPath,
    [serverEntry],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CLAUDE_DESKTOP_PORT: String(backendPort),
        CLAUDE_DESKTOP_AUTH_TOKEN: backendAuthToken,
        CLAUDE_DESKTOP_MODE: "desktop",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  backendProcess.stdout?.on("data", (chunk: Buffer) => {
    backendLog.write(chunk.toString());
  });
  backendProcess.stderr?.on("data", (chunk: Buffer) => {
    backendLog.write(chunk.toString());
  });
  backendProcess.on("exit", (code) => {
    log(`Backend exited with code ${code}`);
  });

  // Wait for server to be ready
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
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

  ipcMain.on("desktop:get-ws-url", (event) => {
    event.returnValue = backendWsUrl;
  });
  ipcMain.handle("desktop:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("desktop:open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  if (isDevelopment) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`${DESKTOP_SCHEME}://app/index.html`);
  }

  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  await startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  backendProcess?.kill();
  app.quit();
});

app.on("before-quit", () => {
  backendProcess?.kill();
});
