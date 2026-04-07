import * as FS from "node:fs";
import * as Path from "node:path";
import * as zlib from "node:zlib";
import { ipcMain, desktopCapturer, globalShortcut, BrowserWindow, screen, Tray, nativeImage, Menu } from "electron";
import { startCapture, stopCapture } from "./action-capture";
import { queryChromeEvents } from "./chrome-bridge";

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:100%; height:100%; overflow:hidden; background:rgba(0,0,0,0.3); cursor:crosshair; user-select:none; }
#sel { position:fixed; border:2px solid #60a5fa; background:rgba(96,165,250,0.12); display:none; pointer-events:none; }
#hint { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); color:white; font:14px/1.8 -apple-system,sans-serif; text-align:center; text-shadow:0 1px 4px rgba(0,0,0,0.9); pointer-events:none; }
</style>
</head>
<body>
<div id="sel"></div>
<div id="hint">Click and drag to select a recording area<br><small style="opacity:0.7">Press Escape to cancel</small></div>
<script>
var startX=0, startY=0, drawing=false;
var sel=document.getElementById('sel'), hint=document.getElementById('hint');
document.addEventListener('mousedown',function(e){
  startX=e.clientX; startY=e.clientY; drawing=true;
  hint.style.display='none';
  sel.style.cssText='display:block;left:'+startX+'px;top:'+startY+'px;width:0;height:0;';
});
document.addEventListener('mousemove',function(e){
  if(!drawing)return;
  var x=Math.min(e.clientX,startX),y=Math.min(e.clientY,startY);
  sel.style.left=x+'px'; sel.style.top=y+'px';
  sel.style.width=Math.abs(e.clientX-startX)+'px';
  sel.style.height=Math.abs(e.clientY-startY)+'px';
});
document.addEventListener('mouseup',function(e){
  if(!drawing)return; drawing=false;
  var x=Math.min(e.clientX,startX),y=Math.min(e.clientY,startY);
  var w=Math.abs(e.clientX-startX),h=Math.abs(e.clientY-startY);
  if(w>10&&h>10){window.overlayAPI.sendResult({x:x,y:y,width:w,height:h});}
  else{window.overlayAPI.cancel();}
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')window.overlayAPI.cancel();});
</script>
</body>
</html>`;

let recordingTray: Tray | null = null;
const resultWatchers = new Map<string, FS.FSWatcher>();

function makePNG(width: number, height: number, pixels: Buffer): Buffer {
  const scanlines = Buffer.allocUnsafe(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    scanlines[y * (1 + width * 4)] = 0;
    pixels.copy(scanlines, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(scanlines);

  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.allocUnsafe(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function createRecordingIcon(size = 16): Electron.NativeImage {
  const pixels = Buffer.allocUnsafe(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = Math.hypot(x - cx + 0.5, y - cy + 0.5) <= r;
      pixels[i]     = inside ? 220 : 0;
      pixels[i + 1] = inside ? 38  : 0;
      pixels[i + 2] = inside ? 38  : 0;
      pixels[i + 3] = inside ? 255 : 0;
    }
  }
  const img = nativeImage.createFromBuffer(makePNG(size, size, pixels));
  img.setTemplateImage(false);
  return img;
}

export function registerRecorderHandlers(getMainWindow: () => BrowserWindow | null): void {
  // --- getSources ---
  ipcMain.handle("recorder:getSources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 160, height: 100 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });

  // --- listFiles ---
  ipcMain.handle("recorder:listFiles", async (_event, cwd: string) => {
    if (!cwd || !Path.isAbsolute(cwd)) return [];
    const dir = Path.join(cwd, "recordings");
    try {
      const entries = await FS.promises.readdir(dir);
      const files = entries.filter((f) => f.endsWith(".webm")).sort().reverse();
      const results = await Promise.all(
        files.map(async (name) => {
          const filePath = Path.join(dir, name);
          const stat = await FS.promises.stat(filePath);
          const dbFile = Path.join(dir, name.replace(".webm", ".db"));
          const dbExists = await FS.promises.access(dbFile).then(() => true).catch(() => false);
          return {
            name,
            path: filePath,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
            dbPath: dbExists ? dbFile : undefined,
          };
        }),
      );
      return results;
    } catch {
      return [];
    }
  });

  // --- sessionStart ---
  ipcMain.handle("recorder:sessionStart", async (_event, cwd: string) => {
    if (!cwd || !Path.isAbsolute(cwd)) throw new Error(`Invalid cwd: ${cwd}`);
    const dir = Path.join(cwd, "recordings");
    await FS.promises.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const stem = ts;
    const dbPath = Path.join(dir, `${stem}.db`);
    const startTime = Date.now();
    const { captureActive } = startCapture(dbPath, startTime);
    return { dbPath: captureActive ? dbPath : null, stem, startTime, captureActive };
  });

  // --- sessionStop ---
  ipcMain.handle("recorder:sessionStop", async () => {
    stopCapture();
  });

  // --- saveFile ---
  ipcMain.handle("recorder:saveFile", async (_event, cwd: string, buffer: ArrayBuffer, stem?: string) => {
    if (!cwd || !Path.isAbsolute(cwd)) throw new Error(`Invalid cwd: ${cwd}`);
    const MAX_SIZE = 200 * 1024 * 1024; // 200 MB
    if (buffer.byteLength > MAX_SIZE) throw new Error(`Recording too large: ${buffer.byteLength} bytes (max 200 MB)`);
    const dir = Path.join(cwd, "recordings");
    await FS.promises.mkdir(dir, { recursive: true });
    const useStem = stem ?? new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const filePath = Path.join(dir, `${useStem}.webm`);
    await FS.promises.writeFile(filePath, Buffer.from(buffer));
    return filePath;
  });

  // --- saveFrame ---
  ipcMain.handle("recorder:saveFrame", async (_event, framePath: string, buffer: ArrayBuffer) => {
    if (!framePath || !Path.isAbsolute(framePath)) throw new Error(`Invalid framePath: ${framePath}`);
    await FS.promises.mkdir(Path.dirname(framePath), { recursive: true });
    await FS.promises.writeFile(framePath, Buffer.from(buffer));
  });

  // --- writeFile ---
  ipcMain.handle("recorder:writeFile", async (_event, filePath: string, content: string) => {
    if (!filePath || !Path.isAbsolute(filePath)) throw new Error(`Invalid filePath: ${filePath}`);
    await FS.promises.mkdir(Path.dirname(filePath), { recursive: true });
    await FS.promises.writeFile(filePath, content, "utf8");
  });

  // --- readFile ---
  ipcMain.handle("recorder:readFile", async (_event, filePath: string) => {
    if (!filePath || !Path.isAbsolute(filePath)) return null;
    try {
      return await FS.promises.readFile(filePath, "utf8");
    } catch {
      return null;
    }
  });

  // --- listFrames ---
  ipcMain.handle("recorder:listFrames", async (_event, framesDir: string) => {
    if (!framesDir || !Path.isAbsolute(framesDir)) return [];
    try {
      const entries = await FS.promises.readdir(framesDir);
      return entries
        .filter((f) => f.startsWith("frame-") && f.endsWith(".jpg"))
        .map((f) => ({
          path: Path.join(framesDir, f),
          ts_ms: parseInt(f.replace("frame-", "").replace(".jpg", ""), 10),
        }))
        .sort((a, b) => a.ts_ms - b.ts_ms);
    } catch {
      return [];
    }
  });

  // --- watchResult ---
  ipcMain.handle("recorder:watchResult", async (_event, stemDir: string) => {
    if (!stemDir || !Path.isAbsolute(stemDir)) return;
    if (resultWatchers.has(stemDir)) return;
    await FS.promises.mkdir(stemDir, { recursive: true });
    try {
      const watcher = FS.watch(stemDir, { persistent: false }, (_eventType, filename) => {
        if (filename === "result.md") {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send("recorder:analysisReady", stemDir);
          }
        }
      });
      resultWatchers.set(stemDir, watcher);
    } catch {
      // Should not happen after mkdir, but guard anyway
    }
  });

  // --- unwatchResult ---
  ipcMain.handle("recorder:unwatchResult", (_event, stemDir: string) => {
    const watcher = resultWatchers.get(stemDir);
    if (watcher) {
      watcher.close();
      resultWatchers.delete(stemDir);
    }
  });

  // --- openOverlay ---
  ipcMain.handle("recorder:openOverlay", (_event, screenSourceId: string) => {
    const displays = screen.getAllDisplays();
    const sourceIndex = parseInt(screenSourceId.split(":")[1] ?? "0", 10);
    // Note: display index mapping from desktopCapturer source ID is a best-effort
    // approximation. Window sources (large N) always fall back to the primary display.
    const display = displays[sourceIndex] ?? displays[0]!;
    const { x, y, width, height } = display.bounds;

    return new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      let settled = false;

      const overlayWin = new BrowserWindow({
        x, y, width, height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: {
          preload: Path.join(__dirname, "overlay-preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      const dataUri = `data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`;
      overlayWin.loadURL(dataUri);
      overlayWin.webContents.on("did-fail-load", () => settle(null));

      const settle = (val: { x: number; y: number; width: number; height: number } | null) => {
        if (settled) return;
        settled = true;
        ipcMain.removeListener("overlay:result", resultHandler);
        ipcMain.removeListener("overlay:cancel", cancelHandler);
        if (!overlayWin.isDestroyed()) overlayWin.close();
        resolve(val);
      };

      const resultHandler = (_e: Electron.IpcMainEvent, region: { x: number; y: number; width: number; height: number }) => {
        settle({ x: region.x, y: region.y, width: region.width, height: region.height });
      };
      const cancelHandler = () => settle(null);

      ipcMain.on("overlay:result", resultHandler);
      ipcMain.on("overlay:cancel", cancelHandler);
      overlayWin.on("closed", () => settle(null));
    });
  });

  // --- tray: show while recording ---
  ipcMain.on("recorder:showTray", () => {
    if (recordingTray) return;
    const icon = createRecordingIcon(16);
    recordingTray = new Tray(icon);
    recordingTray.setToolTip("Recording in progress — click to stop");
    const menu = Menu.buildFromTemplate([
      { label: "Stop Recording", click: () => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) win.webContents.send("recorder:stopFromTray");
      }},
    ]);
    recordingTray.setContextMenu(menu);
    recordingTray.on("click", () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send("recorder:stopFromTray");
    });
  });

  ipcMain.on("recorder:hideTray", () => {
    if (recordingTray) { recordingTray.destroy(); recordingTray = null; }
  });

  // --- queryChrome ---
  ipcMain.handle("recorder:queryChrome", (_event, dbPath: string, fromMs: number, toMs: number) => {
    if (!dbPath || !Path.isAbsolute(dbPath)) return [];
    return queryChromeEvents(dbPath, fromMs, toMs);
  });

  // --- global shortcut ⌘⇧5 ---
  globalShortcut.register("CommandOrControl+Shift+5", () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("recorder:togglePicker");
    }
  });
}
