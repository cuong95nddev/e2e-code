# Screen Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add screen recording to e2e-code — full screen, window, or drawn region — triggered via a Record button in the tab bar or ⌘⇧5, with recordings saved to `{project-cwd}/recordings/*.webm`.

**Architecture:** A new `recorder-manager.ts` in the Electron main process handles IPC (get sources, save file, open overlay) and registers the global shortcut. The renderer has a `useRecorder` hook managing `MediaRecorder` lifecycle (including canvas-based region crop), and `RecordButton` + `RecordingIndicator` components wired into the existing tab bar in `App.tsx`. A transparent full-screen `BrowserWindow` (with its own preload) is opened on demand for region selection.

**Tech Stack:** Electron `desktopCapturer`, Web `MediaRecorder` API, `canvas.captureStream()` for region crop, React + Tailwind CSS, TypeScript, `tsc` build (no bundler).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/desktop/src/recorder-manager.ts` | Create | IPC handlers (getSources, openOverlay, saveFile) + global shortcut |
| `apps/desktop/src/overlay-preload.ts` | Create | contextBridge for overlay window → sends region coords to main |
| `apps/desktop/src/main.ts` | Modify | Import + call `registerRecorderHandlers()` |
| `apps/desktop/src/preload.ts` | Modify | Add `recorder` namespace to ElectronAPI |
| `apps/web/src/electron.d.ts` | Modify | Add `recorder` types + `RecorderSource` interface |
| `apps/web/src/hooks/useRecorder.ts` | Create | MediaRecorder lifecycle, canvas crop, stop+save |
| `apps/web/src/components/RecordingIndicator.tsx` | Create | Timer + Stop button shown while recording |
| `apps/web/src/components/RecordButton.tsx` | Create | Tab bar button + popover source picker |
| `apps/web/src/App.tsx` | Modify | Add `<RecordButton>` to tab bar |

---

## Task 1: Type definitions and preload bridge

**Files:**
- Modify: `apps/web/src/electron.d.ts`
- Modify: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Update `electron.d.ts` with recorder types**

Replace entire file content:

```ts
interface RecorderSource {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL
}

interface ElectronAPI {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  app: {
    pickFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
  };
  recorder: {
    getSources(): Promise<RecorderSource[]>;
    openOverlay(screenSourceId: string): Promise<{ x: number; y: number; width: number; height: number } | null>;
    saveFile(cwd: string, buffer: ArrayBuffer): Promise<string>;
    onTogglePicker(callback: () => void): () => void;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
```

- [ ] **Step 2: Update `preload.ts` — add recorder namespace**

Replace entire file content:

```ts
import { contextBridge, ipcRenderer } from "electron";

export interface ElectronAPI {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  app: {
    pickFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
  };
  recorder: {
    getSources(): Promise<{ id: string; name: string; thumbnail: string }[]>;
    openOverlay(screenSourceId: string): Promise<{ x: number; y: number; width: number; height: number } | null>;
    saveFile(cwd: string, buffer: ArrayBuffer): Promise<string>;
    onTogglePicker(callback: () => void): () => void;
  };
}

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ElectronAPI = {
  pty: {
    create: (sessionId, cwd, cliSessionId, isResume) =>
      ipcRenderer.invoke("pty:create", sessionId, cwd, cliSessionId, isResume),
    write: (sessionId, data) =>
      ipcRenderer.send("pty:write", sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send("pty:resize", sessionId, cols, rows),
    kill: (sessionId) =>
      ipcRenderer.invoke("pty:kill", sessionId),
    onData: (callback) =>
      onChannel("pty:data", (sessionId, data) =>
        callback(sessionId as string, data as string)),
    onExit: (callback) =>
      onChannel("pty:exit", (sessionId, exitCode, signal) =>
        callback(sessionId as string, exitCode as number, signal as number | undefined)),
  },
  app: {
    pickFolder: () => ipcRenderer.invoke("app:pickFolder"),
    openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  },
  recorder: {
    getSources: () => ipcRenderer.invoke("recorder:getSources"),
    openOverlay: (screenSourceId: string) => ipcRenderer.invoke("recorder:openOverlay", screenSourceId),
    saveFile: (cwd: string, buffer: ArrayBuffer) => ipcRenderer.invoke("recorder:saveFile", cwd, buffer),
    onTogglePicker: (callback: () => void) => onChannel("recorder:togglePicker", callback),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload.ts apps/web/src/electron.d.ts
git commit -m "feat: add recorder IPC contract to preload and types"
```

---

## Task 2: recorder-manager.ts — getSources, saveFile, global shortcut

**Files:**
- Create: `apps/desktop/src/recorder-manager.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Create `apps/desktop/src/recorder-manager.ts`**

```ts
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
```

- [ ] **Step 2: Register in `main.ts`**

Add import at the top of `apps/desktop/src/main.ts` (after existing imports):

```ts
import { registerRecorderHandlers } from "./recorder-manager";
```

In `app.whenReady().then(...)`, add the call after `registerIpcHandlers()`:

```ts
app.whenReady().then(() => {
  log("App ready, registering IPC handlers");
  registerIpcHandlers();
  registerRecorderHandlers(() => mainWindow);
  createWindow();
});
```

Also add shortcut cleanup in `app.on("will-quit", ...)` — add this block before `app.quit()` in the `window-all-closed` handler:

```ts
app.on("will-quit", () => {
  const { globalShortcut } = require("electron");
  globalShortcut.unregisterAll();
});
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/desktop && bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/recorder-manager.ts apps/desktop/src/main.ts
git commit -m "feat: add recorder IPC handlers and global shortcut"
```

---

## Task 3: Overlay preload

**Files:**
- Create: `apps/desktop/src/overlay-preload.ts`

- [ ] **Step 1: Create `apps/desktop/src/overlay-preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("overlayAPI", {
  sendResult: (region: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send("overlay:result", region),
  cancel: () => ipcRenderer.send("overlay:cancel"),
});
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/desktop && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Build and smoke-test overlay**

```bash
cd apps/desktop && bun run build
```

Verify that `dist-electron/overlay-preload.js` exists:

```bash
ls apps/desktop/dist-electron/overlay-preload.js
```

Expected: file exists.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/overlay-preload.ts
git commit -m "feat: add overlay preload for region selection window"
```

---

## Task 4: useRecorder hook

**Files:**
- Create: `apps/web/src/hooks/useRecorder.ts`

- [ ] **Step 1: Create `apps/web/src/hooks/useRecorder.ts`**

```ts
import { useState, useRef, useCallback } from "react";

export type RecorderState = "idle" | "recording";

export type RecorderMode = "screen" | "window" | "region";

interface StartOptions {
  sourceId: string;
  mode: RecorderMode;
  cropRegion?: { x: number; y: number; width: number; height: number };
  cwd: string;
}

export function useRecorder() {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const videoElemRef = useRef<HTMLVideoElement | null>(null);
  const cwdRef = useRef<string>("");

  const startRecording = useCallback(async (opts: StartOptions) => {
    cwdRef.current = opts.cwd;

    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // @ts-expect-error Electron-specific constraint
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: opts.sourceId,
        },
      },
    });

    let recordStream: MediaStream = rawStream;

    if (opts.cropRegion) {
      const { x, y, width, height } = opts.cropRegion;
      const dpr = window.devicePixelRatio;

      const video = document.createElement("video");
      video.srcObject = rawStream;
      video.muted = true;
      await video.play();
      videoElemRef.current = video;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;

      const drawFrame = () => {
        ctx.drawImage(video, -Math.round(x * dpr), -Math.round(y * dpr));
        rafRef.current = requestAnimationFrame(drawFrame);
      };
      rafRef.current = requestAnimationFrame(drawFrame);

      recordStream = canvas.captureStream(30);
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(recordStream, { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;

    setElapsed(0);
    setSavedPath(null);
    setRecorderState("recording");
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return "";

    return new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        if (videoElemRef.current) { videoElemRef.current.srcObject = null; videoElemRef.current = null; }

        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const buffer = await blob.arrayBuffer();
        try {
          const path = await window.electronAPI.recorder.saveFile(cwdRef.current, buffer);
          setSavedPath(path);
          setRecorderState("idle");
          resolve(path);
        } catch (err) {
          reject(err);
        }
      };
      recorder.stop();
      mediaRecorderRef.current = null;
    });
  }, []);

  return { recorderState, elapsed, savedPath, startRecording, stopRecording };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && bun run typecheck 2>/dev/null || bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useRecorder.ts
git commit -m "feat: add useRecorder hook with MediaRecorder and canvas crop"
```

---

## Task 5: RecordingIndicator component

**Files:**
- Create: `apps/web/src/components/RecordingIndicator.tsx`

- [ ] **Step 1: Create `apps/web/src/components/RecordingIndicator.tsx`**

```tsx
interface Props {
  elapsed: number;
  onStop: () => void;
}

export function RecordingIndicator({ elapsed, onStop }: Props) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-2 px-3 py-1 border border-[#3d1a1a] bg-[#1a0a0a] rounded-md">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
      <span className="font-mono text-xs text-red-300 tabular-nums">{mm}:{ss}</span>
      <div className="w-px h-3.5 bg-[#3d1a1a]" />
      <button
        onClick={onStop}
        className="text-xs text-[#8b949e] hover:text-white px-1.5 py-0.5 border border-[#30363d] rounded transition-colors"
      >
        Stop
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/RecordingIndicator.tsx
git commit -m "feat: add RecordingIndicator component"
```

---

## Task 6: RecordButton component

**Files:**
- Create: `apps/web/src/components/RecordButton.tsx`

- [ ] **Step 1: Create `apps/web/src/components/RecordButton.tsx`**

```tsx
import { useState, useEffect } from "react";
import { useRecorder, type RecorderMode } from "../hooks/useRecorder";
import { RecordingIndicator } from "./RecordingIndicator";

interface Props {
  cwd: string | null;
}

export function RecordButton({ cwd }: Props) {
  const { recorderState, elapsed, savedPath, startRecording, stopRecording } = useRecorder();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<RecorderMode>("screen");
  const [sources, setSources] = useState<{ id: string; name: string; thumbnail: string }[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Load sources whenever picker opens
  useEffect(() => {
    if (!pickerOpen) return;
    window.electronAPI.recorder.getSources().then((srcs) => {
      setSources(srcs);
      // Auto-select first screen source
      const firstScreen = srcs.find((s) => s.id.startsWith("screen:"));
      if (firstScreen && !selectedSourceId) setSelectedSourceId(firstScreen.id);
    });
  }, [pickerOpen]);

  // Reset source selection when mode changes
  useEffect(() => {
    setSelectedSourceId(null);
  }, [mode]);

  // Listen for global shortcut
  useEffect(() => {
    return window.electronAPI.recorder.onTogglePicker(() => {
      setPickerOpen((v) => !v);
    });
  }, []);

  // Show toast when a recording is saved
  useEffect(() => {
    if (!savedPath) return;
    const fileName = savedPath.split("/").pop() ?? savedPath;
    setToast(`Saved: recordings/${fileName}`);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [savedPath]);

  const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
  const windowSources = sources.filter((s) => !s.id.startsWith("screen:"));

  const handleStart = async () => {
    if (!cwd) return;

    let sourceId = selectedSourceId;
    let cropRegion: { x: number; y: number; width: number; height: number } | undefined;

    if (mode === "region") {
      // Auto-use first screen for region overlay
      const screenId = selectedSourceId ?? screenSources[0]?.id;
      if (!screenId) return;
      setPickerOpen(false);
      const region = await window.electronAPI.recorder.openOverlay(screenId);
      if (!region) return;
      sourceId = screenId;
      cropRegion = region;
    } else {
      if (!sourceId) return;
      setPickerOpen(false);
    }

    await startRecording({ sourceId: sourceId!, mode, cropRegion, cwd });
  };

  const handleStop = async () => {
    await stopRecording();
  };

  const sourcesForMode = mode === "window" ? windowSources : screenSources;

  if (recorderState === "recording") {
    return (
      <>
        <RecordingIndicator elapsed={elapsed} onStop={handleStop} />
        {toast && (
          <div className="fixed bottom-4 right-4 z-50 bg-[#161b22] border border-[#30363d] text-[#e6edf3] text-xs px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-[#30363d] bg-[#21262d] text-[#e6edf3] text-xs hover:bg-[#30363d] transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          Record
          <span className="ml-0.5 text-[10px] text-[#6e7681] bg-[#161b22] px-1 py-0.5 rounded font-sans">
            ⌘⇧5
          </span>
        </button>

        {pickerOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setPickerOpen(false)}
            />
            {/* Popover */}
            <div className="absolute right-0 top-full mt-1 w-72 bg-[#161b22] border border-[#30363d] rounded-xl p-3 shadow-2xl z-20 font-sans">
              {/* Mode selector */}
              <div className="text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">
                Chế độ
              </div>
              <div className="flex gap-1.5 mb-3">
                {(["screen", "window", "region"] as RecorderMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg border text-[11px] transition-colors ${
                      mode === m
                        ? "border-[#388bfd] bg-[#0d1117] text-[#e6edf3]"
                        : "border-[#30363d] bg-[#0d1117] text-[#6e7681] hover:text-[#c9d1d9]"
                    }`}
                  >
                    {m === "screen" ? "🖥 Toàn màn hình" : m === "window" ? "🪟 Cửa sổ" : "✂️ Vùng chọn"}
                  </button>
                ))}
              </div>

              {/* Source list (screen or window) */}
              {mode !== "region" && (
                <>
                  <div className="text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">
                    {mode === "screen" ? "Màn hình" : "Cửa sổ"}
                  </div>
                  {sourcesForMode.length === 0 ? (
                    <div className="text-[11px] text-[#6e7681] mb-3">Đang tải...</div>
                  ) : (
                    <div className="flex gap-2 flex-wrap mb-3">
                      {sourcesForMode.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedSourceId(s.id)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            selectedSourceId === s.id
                              ? "border-[#388bfd]"
                              : "border-[#30363d] hover:border-[#6e7681]"
                          } bg-[#0d1117]`}
                        >
                          <img
                            src={s.thumbnail}
                            className="w-20 h-12 rounded object-cover mb-1"
                            alt={s.name}
                          />
                          <div className="text-[10px] text-[#8b949e] truncate max-w-[80px]">
                            {s.name}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Region mode hint */}
              {mode === "region" && (
                <div className="mb-3 py-3 border border-dashed border-[#30363d] rounded-lg text-center text-[#6e7681] text-xs">
                  ✂️ Kéo chọn vùng sau khi nhấn bắt đầu
                </div>
              )}

              <button
                onClick={handleStart}
                disabled={mode !== "region" && !selectedSourceId}
                className="w-full py-2 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Bắt đầu quay ⏺
              </button>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#161b22] border border-[#30363d] text-[#e6edf3] text-xs px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/RecordButton.tsx
git commit -m "feat: add RecordButton component with source picker popover"
```

---

## Task 7: Wire up App.tsx

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add import at the top of `App.tsx`**

After the existing `import { Terminal } ...` line, add:

```ts
import { RecordButton } from "./components/RecordButton";
```

- [ ] **Step 2: Add `<RecordButton>` to the tab bar**

In `App.tsx`, find the tab bar's `+` button section. The current code ends with:

```tsx
          <button
            onClick={() => createSession()}
            className="px-2 py-1.5 text-[#8b949e] hover:text-white text-sm"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            +
          </button>
```

Add `<RecordButton>` directly after that `+` button, still inside the same flex container:

```tsx
          <button
            onClick={() => createSession()}
            className="px-2 py-1.5 text-[#8b949e] hover:text-white text-sm"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            +
          </button>

          <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <RecordButton cwd={activeSession?.cwd ?? null} />
          </div>
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: add RecordButton to tab bar in App"
```

---

## Task 8: Build, run, and verify end-to-end

- [ ] **Step 1: Full build**

```bash
cd /Users/cuongpham/ws/automation && bun run build
```

Expected: no TypeScript errors, `apps/desktop/dist-electron/` contains `main.js`, `preload.js`, `overlay-preload.js`.

- [ ] **Step 2: Run the app**

```bash
bun run dev
```

- [ ] **Step 3: Verify Record button appears**

Open a project folder. Confirm the Record button appears in the top-right of the tab bar with the ⌘⇧5 hint.

- [ ] **Step 4: Verify source picker**

Click Record. Confirm the popover opens showing screen/window thumbnails. Switch between Toàn màn hình / Cửa sổ / Vùng chọn modes.

- [ ] **Step 5: Verify full-screen recording**

Select "Toàn màn hình", pick a screen, click "Bắt đầu quay". Confirm the timer appears in the tab bar. Wait 3 seconds, click Stop. Confirm a toast appears with the file path. Verify the file exists:

```bash
ls ~/path/to/your/project/recordings/
```

Expected: a `.webm` file with a timestamp name.

- [ ] **Step 6: Verify region recording**

Click Record → Vùng chọn → Bắt đầu quay. Confirm a transparent overlay appears. Drag a rectangle. Confirm recording starts. Stop and verify the `.webm` file is cropped to the selected region when opened in a video player.

- [ ] **Step 7: Verify ⌘⇧5 shortcut**

Press ⌘⇧5. Confirm the picker popover toggles open/closed.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: screen recording — full screen, window, and region capture"
```
