# Action Capture + Screen Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture system-wide mouse/keyboard/scroll events into a SQLite DB alongside each screen recording, then display them as a timeline overlay in a video player.

**Architecture:** `uiohook-napi` runs in the Electron main process, writing events synchronously to `better-sqlite3`. Each `.webm` recording gets a paired `.db` file with the same filename stem. A new `RecordingPlayer` component renders the video with a timeline of action markers.

**Tech Stack:** `uiohook-napi`, `better-sqlite3`, React, Electron IPC, Tailwind CSS

---

## File Map

**Create:**
- `apps/desktop/src/action-capture.ts` — uiohook lifecycle + SQLite writes + IPC handlers
- `apps/web/src/components/RecordingPlayer.tsx` — video player with action timeline

**Modify:**
- `apps/desktop/package.json` — add `uiohook-napi`, `better-sqlite3`; update rebuild script
- `apps/desktop/src/recorder-manager.ts` — add `recorder:sessionStart` / `recorder:sessionStop` / `recorder:listFiles` (add dbPath)
- `apps/desktop/src/preload.ts` — expose `sessionStart`, `sessionStop`, `queryActions`; update `RecordingMeta`
- `apps/web/src/electron.d.ts` — add types for new IPC calls and `ActionEvent`
- `apps/web/src/hooks/useRecorder.ts` — call `sessionStart`/`sessionStop`, expose `savedDbPath`
- `apps/web/src/components/RecordingsList.tsx` — add Play button → open `RecordingPlayer`
- `apps/desktop/src/main.ts` — import and register `registerActionCaptureHandlers`

---

## Task 1: Install Dependencies

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Add dependencies and update rebuild script**

Edit `apps/desktop/package.json`:

```json
{
  "name": "@e2e-code/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "postinstall": "electron-rebuild -f -w node-pty,uiohook-napi,better-sqlite3",
    "dev": "tsc && VITE_DEV_SERVER_URL=http://localhost:5733 electron .",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^12.8.0",
    "electron": "41.1.1",
    "node-pty": "^1.1.0",
    "uiohook-napi": "^1.5.3"
  },
  "devDependencies": {
    "@electron/rebuild": "^4.0.3",
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "catalog:",
    "typescript": "catalog:"
  },
  "productName": "Claude Desktop"
}
```

- [ ] **Step 2: Install and rebuild**

```bash
cd /Users/cuongpham/ws/automation
bun install
```

Expected: `node_modules/uiohook-napi` and `node_modules/better-sqlite3` present, both rebuilt for Electron ABI.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json bun.lock
git commit -m "chore: add uiohook-napi and better-sqlite3 dependencies"
```

---

## Task 2: Create `action-capture.ts`

**Files:**
- Create: `apps/desktop/src/action-capture.ts`

- [ ] **Step 1: Create the module**

Create `apps/desktop/src/action-capture.ts`:

```typescript
import * as Path from "node:path";
import * as FS from "node:fs";
import Database from "better-sqlite3";
import { uIOhook, UiohookMouseEvent, UiohookKeyboardEvent, UiohookWheelEvent } from "uiohook-napi";
import { ipcMain, systemPreferences } from "electron";

interface SessionState {
  db: Database.Database;
  insert: Database.Statement;
  startTime: number;
}

let session: SessionState | null = null;

function tsMs(): number {
  if (!session) return 0;
  return Date.now() - session.startTime;
}

function ins(row: {
  type: string;
  x?: number | null;
  y?: number | null;
  button?: number | null;
  keycode?: number | null;
  key_char?: string | null;
  modifiers?: string | null;
  delta_x?: number | null;
  delta_y?: number | null;
}): void {
  if (!session) return;
  try {
    session.insert.run({
      type: row.type,
      ts_ms: tsMs(),
      x: row.x ?? null,
      y: row.y ?? null,
      button: row.button ?? null,
      keycode: row.keycode ?? null,
      key_char: row.key_char ?? null,
      modifiers: row.modifiers ?? null,
      delta_x: row.delta_x ?? null,
      delta_y: row.delta_y ?? null,
    });
  } catch (err) {
    console.error("[action-capture] insert error:", err);
  }
}

function kmods(e: UiohookKeyboardEvent): string {
  return JSON.stringify({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
}

const handlers = {
  mousedown: (e: UiohookMouseEvent) => ins({ type: "mousedown", x: e.x, y: e.y, button: e.button }),
  mouseup:   (e: UiohookMouseEvent) => ins({ type: "mouseup",   x: e.x, y: e.y, button: e.button }),
  keydown:   (e: UiohookKeyboardEvent) => ins({ type: "keydown", keycode: e.keycode, modifiers: kmods(e) }),
  keyup:     (e: UiohookKeyboardEvent) => ins({ type: "keyup",   keycode: e.keycode, modifiers: kmods(e) }),
  wheel:     (e: UiohookWheelEvent) => ins({ type: "wheel", x: e.x, y: e.y, delta_y: e.rotation }),
};

function openDb(dbPath: string): SessionState {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY,
      type      TEXT    NOT NULL,
      ts_ms     INTEGER NOT NULL,
      x         INTEGER,
      y         INTEGER,
      button    INTEGER,
      keycode   INTEGER,
      key_char  TEXT,
      modifiers TEXT,
      delta_x   REAL,
      delta_y   REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ts ON events(ts_ms);
  `);
  const insert = db.prepare(`
    INSERT INTO events (type, ts_ms, x, y, button, keycode, key_char, modifiers, delta_x, delta_y)
    VALUES (@type, @ts_ms, @x, @y, @button, @keycode, @key_char, @modifiers, @delta_x, @delta_y)
  `);
  return { db, insert, startTime: Date.now() };
}

export function startCapture(dbPath: string): { captureActive: boolean } {
  if (session) {
    uIOhook.stop();
    uIOhook.removeAllListeners();
    session.db.close();
    session = null;
  }

  FS.mkdirSync(Path.dirname(dbPath), { recursive: true });
  session = openDb(dbPath);

  // macOS: check Accessibility permission (prompt=true shows system dialog)
  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      // User needs to grant access and restart; recording continues without capture
      session.db.close();
      session = null;
      return { captureActive: false };
    }
  }

  uIOhook.on("mousedown", handlers.mousedown);
  uIOhook.on("mouseup",   handlers.mouseup);
  uIOhook.on("keydown",   handlers.keydown);
  uIOhook.on("keyup",     handlers.keyup);
  uIOhook.on("wheel",     handlers.wheel);
  uIOhook.start();
  return { captureActive: true };
}

export function stopCapture(): void {
  if (!session) return;
  uIOhook.stop();
  uIOhook.removeAllListeners();
  session.db.close();
  session = null;
}

export function registerActionCaptureHandlers(): void {
  ipcMain.handle("actions:start", (_event, dbPath: string) => startCapture(dbPath));

  ipcMain.handle("actions:stop", () => stopCapture());

  ipcMain.handle("actions:query", async (_event, dbPath: string, fromMs: number, toMs: number) => {
    if (!dbPath || !Path.isAbsolute(dbPath)) return [];
    try {
      const qdb = new Database(dbPath, { readonly: true });
      const rows = qdb
        .prepare("SELECT * FROM events WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms")
        .all(fromMs, toMs);
      qdb.close();
      return rows;
    } catch {
      return [];
    }
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/action-capture.ts
git commit -m "feat: add action-capture module with uiohook + SQLite IPC handlers"
```

---

## Task 3: Update `recorder-manager.ts`

**Files:**
- Modify: `apps/desktop/src/recorder-manager.ts`

The `recorder:sessionStart` handler generates a filename stem, creates the DB path, delegates to `actions:start`, and returns `{ dbPath, stem }`. `recorder:sessionStop` calls `actions:stop`. `recorder:listFiles` now checks for the sibling `.db` file.

- [ ] **Step 1: Add sessionStart / sessionStop to recorder-manager.ts**

Add to the top of `apps/desktop/src/recorder-manager.ts` (after existing imports):

```typescript
import { startCapture, stopCapture } from "./action-capture";
```

Inside `registerRecorderHandlers`, add after the existing `recorder:listFiles` handler:

```typescript
  // --- sessionStart ---
  ipcMain.handle("recorder:sessionStart", async (_event, cwd: string) => {
    if (!cwd || !Path.isAbsolute(cwd)) throw new Error(`Invalid cwd: ${cwd}`);
    const dir = Path.join(cwd, "recordings");
    await FS.promises.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const stem = ts;
    const dbPath = Path.join(dir, `${stem}.db`);
    const startTime = Date.now();
    await startCapture(dbPath);
    return { dbPath, stem, startTime };
  });

  // --- sessionStop ---
  ipcMain.handle("recorder:sessionStop", async () => {
    stopCapture();
  });
```

- [ ] **Step 2: Update listFiles to include dbPath**

Replace the `recorder:listFiles` handler body:

Old `return results` line — replace the map callback with:

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/recorder-manager.ts
git commit -m "feat: add sessionStart/sessionStop IPC and update listFiles with dbPath"
```

---

## Task 4: Update `preload.ts` and `electron.d.ts`

**Files:**
- Modify: `apps/desktop/src/preload.ts`
- Modify: `apps/web/src/electron.d.ts`

- [ ] **Step 1: Update RecordingMeta and add ActionEvent in preload.ts**

In `apps/desktop/src/preload.ts`, update `RecordingMeta` and `ElectronAPI`:

Replace:
```typescript
export interface RecordingMeta {
  name: string;
  path: string;
  size: number;
  createdAt: string;
}
```
With:
```typescript
export interface RecordingMeta {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  dbPath?: string;
}

export interface ActionEvent {
  id: number;
  type: string;
  ts_ms: number;
  x: number | null;
  y: number | null;
  button: number | null;
  keycode: number | null;
  key_char: string | null;
  modifiers: string | null;
  delta_x: number | null;
  delta_y: number | null;
}
```

In the `recorder` block of `ElectronAPI`, add after `onStopFromTray`:
```typescript
    sessionStart(cwd: string): Promise<{ dbPath: string; stem: string; startTime: number }>;
    sessionStop(): Promise<void>;
    queryActions(dbPath: string, fromMs: number, toMs: number): Promise<ActionEvent[]>;
```

In the `api` object's `recorder` block, add after `onStopFromTray`:
```typescript
    sessionStart: (cwd: string) => ipcRenderer.invoke("recorder:sessionStart", cwd),
    sessionStop: () => ipcRenderer.invoke("recorder:sessionStop"),
    queryActions: (dbPath: string, fromMs: number, toMs: number) =>
      ipcRenderer.invoke("actions:query", dbPath, fromMs, toMs),
```

- [ ] **Step 2: Update electron.d.ts**

Replace the entire content of `apps/web/src/electron.d.ts`:

```typescript
interface RecorderSource {
  id: string;
  name: string;
  thumbnail: string;
}

interface RecordingMeta {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  dbPath?: string;
}

interface ActionEvent {
  id: number;
  type: string;
  ts_ms: number;
  x: number | null;
  y: number | null;
  button: number | null;
  keycode: number | null;
  key_char: string | null;
  modifiers: string | null;
  delta_x: number | null;
  delta_y: number | null;
}

interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
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
    openOverlay(screenSourceId: string): Promise<ScreenRegion | null>;
    saveFile(cwd: string, buffer: ArrayBuffer, stem?: string): Promise<string>;
    listFiles(cwd: string): Promise<RecordingMeta[]>;
    onTogglePicker(callback: () => void): () => void;
    showTray(): void;
    hideTray(): void;
    onStopFromTray(callback: () => void): () => void;
    sessionStart(cwd: string): Promise<{ dbPath: string; stem: string; startTime: number }>;
    sessionStop(): Promise<void>;
    queryActions(dbPath: string, fromMs: number, toMs: number): Promise<ActionEvent[]>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
```

- [ ] **Step 3: Update saveFile IPC handler to accept optional stem**

In `apps/desktop/src/recorder-manager.ts`, replace the `recorder:saveFile` handler:

```typescript
  ipcMain.handle("recorder:saveFile", async (_event, cwd: string, buffer: ArrayBuffer, stem?: string) => {
    if (!cwd || !Path.isAbsolute(cwd)) throw new Error(`Invalid cwd: ${cwd}`);
    const MAX_SIZE = 200 * 1024 * 1024;
    if (buffer.byteLength > MAX_SIZE) throw new Error(`Recording too large: ${buffer.byteLength} bytes (max 200 MB)`);
    const dir = Path.join(cwd, "recordings");
    await FS.promises.mkdir(dir, { recursive: true });
    const useStem = stem ?? new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const filePath = Path.join(dir, `${useStem}.webm`);
    await FS.promises.writeFile(filePath, Buffer.from(buffer));
    return filePath;
  });
```

Also update the `saveFile` signature in `preload.ts` ElectronAPI recorder block:
```typescript
    saveFile(cwd: string, buffer: ArrayBuffer, stem?: string): Promise<string>;
```

And in the api object:
```typescript
    saveFile: (cwd: string, buffer: ArrayBuffer, stem?: string) =>
      ipcRenderer.invoke("recorder:saveFile", cwd, buffer, stem),
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload.ts apps/web/src/electron.d.ts apps/desktop/src/recorder-manager.ts
git commit -m "feat: add sessionStart/sessionStop/queryActions to preload bridge and types"
```

---

## Task 5: Update `useRecorder.ts`

**Files:**
- Modify: `apps/web/src/hooks/useRecorder.ts`

- [ ] **Step 1: Add sessionStart/sessionStop calls and expose savedDbPath**

Replace the entire content of `apps/web/src/hooks/useRecorder.ts`:

```typescript
import { useState, useRef, useCallback, useEffect } from "react";

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
  const [savedDbPath, setSavedDbPath] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const videoElemRef = useRef<HTMLVideoElement | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const cwdRef = useRef<string>("");
  const stemRef = useRef<string | undefined>(undefined);
  const dbPathRef = useRef<string | null>(null);

  const startRecording = useCallback(async (opts: StartOptions) => {
    cwdRef.current = opts.cwd;

    // Start action capture session first (get stem for filename pairing)
    const session = await window.electronAPI.recorder.sessionStart(opts.cwd);
    stemRef.current = session.stem;
    dbPathRef.current = session.dbPath;

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

    rawStreamRef.current = rawStream;
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
    setSavedDbPath(null);
    setRecorderState("recording");
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
    window.electronAPI.recorder.showTray();
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorderState !== "recording") return "";

    return new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        if (videoElemRef.current) { videoElemRef.current.srcObject = null; videoElemRef.current = null; }
        if (rawStreamRef.current) { rawStreamRef.current.getTracks().forEach((t) => t.stop()); rawStreamRef.current = null; }

        // Stop action capture before saving video
        await window.electronAPI.recorder.sessionStop();

        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const buffer = await blob.arrayBuffer();
        try {
          const path = await window.electronAPI.recorder.saveFile(
            cwdRef.current,
            buffer,
            stemRef.current,
          );
          window.electronAPI.recorder.hideTray();
          setSavedPath(path);
          setSavedDbPath(dbPathRef.current);
          setRecorderState("idle");
          resolve(path);
        } catch (err) {
          reject(err);
        }
      };
      recorder.stop();
      mediaRecorderRef.current = null;
    });
  }, [recorderState]);

  useEffect(() => {
    return window.electronAPI.recorder.onStopFromTray(() => {
      stopRecording();
    });
  }, [stopRecording]);

  return { recorderState, elapsed, savedPath, savedDbPath, startRecording, stopRecording };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/hooks/useRecorder.ts
git commit -m "feat: integrate sessionStart/sessionStop into useRecorder, expose savedDbPath"
```

---

## Task 6: Register handlers in `main.ts`

**Files:**
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Import and register action-capture handlers**

In `apps/desktop/src/main.ts`, add the import after the existing imports:

```typescript
import { registerActionCaptureHandlers } from "./action-capture";
```

In the `app.whenReady()` callback, add after `registerRecorderHandlers`:

```typescript
  registerActionCaptureHandlers();
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat: register action-capture IPC handlers in main process"
```

---

## Task 7: Create `RecordingPlayer.tsx`

**Files:**
- Create: `apps/web/src/components/RecordingPlayer.tsx`

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/RecordingPlayer.tsx`:

```typescript
import { useRef, useState, useEffect, useCallback } from "react";

interface Props {
  videoPath: string;
  dbPath: string | undefined;
  onClose: () => void;
}

const TYPE_COLOR: Record<string, string> = {
  mousedown: "#388bfd",
  mouseup:   "#1f6feb",
  keydown:   "#3fb950",
  keyup:     "#238636",
  wheel:     "#8b949e",
};

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${frac}`;
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    mousedown: "click ↓",
    mouseup:   "click ↑",
    keydown:   "key ↓",
    keyup:     "key ↑",
    wheel:     "scroll",
  };
  return map[type] ?? type;
}

function describeEvent(e: ActionEvent): string {
  if (e.type === "mousedown" || e.type === "mouseup") {
    const btn = e.button === 2 ? "right" : e.button === 1 ? "mid" : "left";
    return `${btn} (${e.x}, ${e.y})`;
  }
  if (e.type === "keydown" || e.type === "keyup") {
    if (e.key_char) return `"${e.key_char}"`;
    return `keycode ${e.keycode}`;
  }
  if (e.type === "wheel") {
    return `Δ${e.delta_y ?? 0 > 0 ? "↑" : "↓"}`;
  }
  return "";
}

export function RecordingPlayer({ videoPath, dbPath, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Load events when video metadata is ready
  const handleMetadata = useCallback(async () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(d * 1000);
    if (!dbPath) return;
    const evts = await window.electronAPI.recorder.queryActions(dbPath, 0, d * 1000);
    setEvents(evts);
  }, [dbPath]);

  // Track current time
  const handleTimeUpdate = useCallback(() => {
    const ms = (videoRef.current?.currentTime ?? 0) * 1000;
    setCurrentMs(ms);
  }, []);

  // Seek video to event time
  const seekTo = useCallback((ms: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ms / 1000;
  }, []);

  // Scroll event list to keep current event in view
  useEffect(() => {
    if (!listRef.current || events.length === 0) return;
    const idx = events.findIndex((e) => e.ts_ms > currentMs) - 1;
    if (idx < 0) return;
    const el = listRef.current.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [currentMs, events]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center font-sans">
      <div className="w-[90vw] max-w-5xl bg-[#0d1117] border border-[#30363d] rounded-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363d]">
          <span className="text-xs text-[#8b949e]">Recording Player</span>
          <button
            onClick={onClose}
            className="text-[#6e7681] hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Video */}
        <div className="bg-black flex-shrink-0">
          <video
            ref={videoRef}
            src={`recording://${videoPath}`}
            controls
            className="w-full max-h-[45vh] object-contain"
            onLoadedMetadata={handleMetadata}
            onTimeUpdate={handleTimeUpdate}
          />
        </div>

        {/* Timeline */}
        {duration > 0 && (
          <div className="px-4 py-2 border-t border-[#30363d] flex-shrink-0">
            <div
              className="relative h-6 bg-[#161b22] rounded cursor-crosshair"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                seekTo(ratio * duration);
              }}
            >
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-[#388bfd]"
                style={{ left: `${(currentMs / duration) * 100}%` }}
              />
              {/* Event markers */}
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="absolute top-1 w-1.5 h-1.5 rounded-full -translate-x-1/2 cursor-pointer hover:scale-150 transition-transform"
                  style={{
                    left: `${(ev.ts_ms / duration) * 100}%`,
                    backgroundColor: TYPE_COLOR[ev.type] ?? "#8b949e",
                  }}
                  onClick={(e) => { e.stopPropagation(); seekTo(ev.ts_ms); }}
                  title={`${formatMs(ev.ts_ms)} ${ev.type}`}
                />
              ))}
              {/* Time labels */}
              <div className="absolute left-0 bottom-0 text-[9px] text-[#6e7681] translate-y-full pt-0.5">0s</div>
              <div className="absolute right-0 bottom-0 text-[9px] text-[#6e7681] translate-y-full pt-0.5">
                {formatMs(duration)}
              </div>
            </div>
          </div>
        )}

        {/* Event list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-2 min-h-0"
        >
          {events.length === 0 && (
            <div className="text-xs text-[#6e7681] text-center py-4">
              {dbPath ? "No actions captured" : "No action data for this recording"}
            </div>
          )}
          {events.map((ev) => (
            <button
              key={ev.id}
              onClick={() => seekTo(ev.ts_ms)}
              className={`w-full flex items-center gap-3 px-2 py-1 rounded text-left hover:bg-[#161b22] transition-colors ${
                ev.ts_ms <= currentMs && (events[events.indexOf(ev) + 1]?.ts_ms ?? Infinity) > currentMs
                  ? "bg-[#161b22]"
                  : ""
              }`}
            >
              <span className="text-[10px] text-[#8b949e] font-mono w-16 flex-shrink-0">
                {formatMs(ev.ts_ms)}
              </span>
              <span
                className="text-[10px] w-14 flex-shrink-0 font-mono"
                style={{ color: TYPE_COLOR[ev.type] ?? "#8b949e" }}
              >
                {formatType(ev.type)}
              </span>
              <span className="text-[10px] text-[#6e7681] truncate">{describeEvent(ev)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/RecordingPlayer.tsx
git commit -m "feat: add RecordingPlayer component with video + action timeline"
```

---

## Task 8: Update `RecordingsList.tsx` to open player

**Files:**
- Modify: `apps/web/src/components/RecordingsList.tsx`

- [ ] **Step 1: Add Play button and RecordingPlayer modal**

Replace the entire content of `apps/web/src/components/RecordingsList.tsx`:

```typescript
import { useState, useEffect } from "react";
import { RecordingPlayer } from "./RecordingPlayer";

interface Props {
  cwd: string | null;
  refreshKey: number;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatName(name: string): string {
  return name.replace(".webm", "").replace("_", " ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");
}

export function RecordingsList({ cwd, refreshKey, selectedPath, onSelect }: Props) {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [playerRecording, setPlayerRecording] = useState<RecordingMeta | null>(null);

  useEffect(() => {
    if (!cwd) { setRecordings([]); return; }
    window.electronAPI.recorder.listFiles(cwd).then(setRecordings);
  }, [cwd, refreshKey]);

  if (recordings.length === 0) return null;

  return (
    <>
      <div className="mt-3 font-sans flex flex-col min-h-0">
        <div className="text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">
          Recordings ({recordings.length})
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto">
          {recordings.map((r) => (
            <div
              key={r.path}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors flex-shrink-0 ${
                selectedPath === r.path
                  ? "border-[#388bfd] bg-[#0d1117] text-[#e6edf3]"
                  : "border-[#30363d] bg-[#161b22] text-[#8b949e] hover:border-[#6e7681] hover:text-[#c9d1d9]"
              }`}
            >
              <button
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                onClick={() => onSelect(selectedPath === r.path ? null : r.path)}
              >
                <span className="text-sm">🎬</span>
                <span className="flex-1 text-xs font-mono truncate">{formatName(r.name)}</span>
                <span className="text-[10px] text-[#6e7681] flex-shrink-0">{formatSize(r.size)}</span>
              </button>
              <button
                onClick={() => setPlayerRecording(r)}
                className="flex-shrink-0 px-2 py-0.5 text-[10px] rounded border border-[#30363d] hover:border-[#388bfd] hover:text-[#388bfd] transition-colors"
                title="Open player with action timeline"
              >
                ▶
              </button>
            </div>
          ))}
        </div>
      </div>

      {playerRecording && (
        <RecordingPlayer
          videoPath={playerRecording.path}
          dbPath={playerRecording.dbPath}
          onClose={() => setPlayerRecording(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/RecordingsList.tsx
git commit -m "feat: add Play button to RecordingsList, open RecordingPlayer modal"
```

---

## Task 9: Typecheck and smoke test

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: no TypeScript errors. Fix any type mismatches before proceeding.

- [ ] **Step 2: Run the app**

```bash
bun run dev
```

Expected: app starts without errors in terminal.

- [ ] **Step 3: Smoke test recording + capture**

1. Click "Record" → select screen → click "Bắt đầu quay"
2. On macOS: system Accessibility dialog may appear → grant permission → restart app
3. Click a few times, press some keys, scroll
4. Stop recording (click stop button or tray icon)
5. In RecordingsList, click ▶ on the new recording
6. Player opens, video plays, markers appear on timeline
7. Click a marker → video seeks to that timestamp

- [ ] **Step 4: Final commit if any last fixes**

```bash
git add -A
git commit -m "fix: post-integration fixes after smoke test"
```
