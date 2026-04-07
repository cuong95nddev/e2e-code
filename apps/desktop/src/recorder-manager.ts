import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { ipcMain, desktopCapturer, globalShortcut, BrowserWindow, screen } from "electron";

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

  // --- saveFile ---
  ipcMain.handle("recorder:saveFile", async (_event, cwd: string, buffer: ArrayBuffer) => {
    const dir = Path.join(cwd, "recordings");
    FS.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const filePath = Path.join(dir, `${ts}.webm`);
    FS.writeFileSync(filePath, Buffer.from(buffer));
    return filePath;
  });

  // --- openOverlay ---
  ipcMain.handle("recorder:openOverlay", async (_event, screenSourceId: string) => {
    // Map source index to display bounds
    const displays = screen.getAllDisplays();
    const sourceIndex = parseInt(screenSourceId.split(":")[1] ?? "0", 10);
    const display = displays[sourceIndex] ?? displays[0]!;
    const { x, y, width, height } = display.bounds;

    return new Promise<{ x: number; y: number; width: number; height: number } | null>((resolve) => {
      let settled = false;
      const settle = (val: { x: number; y: number; width: number; height: number } | null) => {
        if (settled) return;
        settled = true;
        ipcMain.removeAllListeners("overlay:result");
        ipcMain.removeAllListeners("overlay:cancel");
        if (!overlayWin.isDestroyed()) overlayWin.close();
        resolve(val);
      };

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

      // Write overlay HTML to temp file and load it
      const tmpHtml = Path.join(OS.tmpdir(), "e2e-code-overlay.html");
      FS.writeFileSync(tmpHtml, OVERLAY_HTML);
      overlayWin.loadFile(tmpHtml);

      ipcMain.once("overlay:result", (_e, region: { x: number; y: number; width: number; height: number }) => {
        settle({ x: region.x, y: region.y, width: region.width, height: region.height });
      });

      ipcMain.once("overlay:cancel", () => settle(null));
      overlayWin.on("closed", () => settle(null));
    });
  });

  // --- global shortcut ⌘⇧5 ---
  globalShortcut.register("CommandOrControl+Shift+5", () => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send("recorder:togglePicker");
    }
  });
}
