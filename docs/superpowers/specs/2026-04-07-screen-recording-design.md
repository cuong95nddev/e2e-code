# Screen Recording Feature Design

**Date:** 2026-04-07  
**Status:** Approved

## Overview

Add screen recording to e2e-code, similar to macOS screen recording. The user triggers recording via a button in the app's tab bar or the ⌘⇧5 shortcut. They can record the full screen, a specific window, or a custom-drawn region. Recordings are saved automatically to `{project-cwd}/recordings/` as `.webm` files.

## UI

- **Record button** in the tab bar (right side), shows ⌘⇧5 hint
- Clicking opens a **popover** (below the button) with:
  - Mode selector: Full Screen / Window / Region
  - Screen/window thumbnails to choose source
  - "Bắt đầu quay" button
- While recording: nút Record is replaced by a **timer + Stop button** inline in the tab bar
- On stop: a brief toast notification shows the saved file path

## Architecture

### Main process — `apps/desktop/src/recorder-manager.ts`

Responsibilities:
- Register global shortcut ⌘⇧5 → send `recorder:togglePicker` to renderer
- IPC handler `recorder:getSources` → calls `desktopCapturer.getSources({ types: ['screen', 'window'] })`, returns `{ id, name, thumbnail (base64) }[]`
- IPC handler `recorder:openOverlay(screenId)` → creates a transparent, full-screen, always-on-top `BrowserWindow` loaded from the overlay HTML; returns `{x, y, width, height}` when user finishes drawing, then closes the window
- IPC handler `recorder:saveFile(sessionId, buffer)` → writes `ArrayBuffer` to `{session.cwd}/recordings/YYYY-MM-DD_HH-mm-ss.webm`, creates the `recordings/` dir if needed, returns the saved file path
- Registered in `main.ts` alongside existing IPC handlers

### Renderer — `apps/web/src/`

**`components/RecordButton.tsx`**
- Renders the Record button in the tab bar
- Manages popover open/close state
- Calls `useRecorder` hook for all recording logic
- When recording: renders `<RecordingIndicator>` instead

**`components/RecordingIndicator.tsx`**
- Shows blinking red dot + elapsed timer (`MM:SS`)
- Stop button → calls `stopRecording()`

**`hooks/useRecorder.ts`**
- State: `idle | picking | selecting-region | recording`
- `startRecording(sourceId, mode, cropRegion?)`:
  1. Calls `getUserMedia` with `{ video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } }`
  2. If `cropRegion` provided: pipes stream through a hidden `<video>` + `<canvas>` that draws only the cropped area; calls `canvas.captureStream(30)` to get the cropped stream
  3. Creates `MediaRecorder` on the (possibly cropped) stream, collects chunks
- `stopRecording()`: finalizes `MediaRecorder` → assembles `Blob` → converts to `ArrayBuffer` → calls `recorder:saveFile` IPC → shows toast with path

**`App.tsx`** — add `<RecordButton sessionCwd={activeSession?.cwd} />` in the tab bar

### Overlay window — `apps/desktop/src/overlay/`

A minimal HTML page (`overlay.html` + `overlay.js`) bundled with the desktop app:
- Full-screen transparent `BrowserWindow` (`transparent: true`, `frame: false`, `alwaysOnTop: true`)
- Dark semi-transparent crosshair overlay
- User clicks + drags to draw a rectangle; on mouse-up sends `ipcRenderer.send('overlay:result', {x, y, width, height})` and the main process closes the window

### IPC channels (new)

| Channel | Direction | Payload |
|---|---|---|
| `recorder:togglePicker` | main → renderer | — |
| `recorder:getSources` | renderer → main | → `Source[]` |
| `recorder:openOverlay` | renderer → main | `screenId` → `{x,y,w,h}` |
| `recorder:saveFile` | renderer → main | `{sessionId, buffer}` → `filePath` |
| `overlay:result` | overlay → main | `{x,y,width,height}` |

### Preload updates

Add to `ElectronAPI`:
```ts
recorder: {
  getSources(): Promise<Source[]>;
  openOverlay(screenId: string): Promise<{x:number,y:number,width:number,height:number}>;
  saveFile(sessionId: string, buffer: ArrayBuffer): Promise<string>;
  onTogglePicker(cb: () => void): () => void;
}
```

## Data flow

```
User presses ⌘⇧5 / clicks Record
  → Main sends recorder:togglePicker to renderer
  → RecordButton opens popover
  → User picks mode + source → clicks "Bắt đầu quay"
  → If Region mode: renderer calls recorder:openOverlay
      → Main opens transparent overlay window
      → User draws region → overlay sends coordinates → main closes overlay
      → renderer receives {x,y,width,height}
  → renderer calls getUserMedia with sourceId
  → If region: pipe through hidden video → canvas crop → captureStream
  → MediaRecorder starts on stream
  → Timer ticks in RecordingIndicator
  → User clicks Stop
  → MediaRecorder stops → Blob → ArrayBuffer
  → recorder:saveFile IPC → file written to {cwd}/recordings/
  → Toast: "Saved to recordings/2026-04-07_10-30-00.webm"
```

## Output

- Format: `.webm` (VP8, native Chromium MediaRecorder — no ffmpeg needed)
- Path: `{session.cwd}/recordings/YYYY-MM-DD_HH-mm-ss.webm`
- The `recordings/` directory is created automatically on first save

## Files changed / created

| File | Change |
|---|---|
| `apps/desktop/src/recorder-manager.ts` | New — IPC handlers + shortcut registration |
| `apps/desktop/src/overlay/overlay.html` | New — region selection overlay |
| `apps/desktop/src/overlay/overlay.js` | New — overlay drag logic |
| `apps/desktop/src/main.ts` | Import and call `registerRecorderHandlers()` |
| `apps/desktop/src/preload.ts` | Add `recorder` to `ElectronAPI` |
| `apps/web/src/electron.d.ts` | Add `recorder` types |
| `apps/web/src/hooks/useRecorder.ts` | New — MediaRecorder hook |
| `apps/web/src/components/RecordButton.tsx` | New — button + popover |
| `apps/web/src/components/RecordingIndicator.tsx` | New — timer + stop button |
| `apps/web/src/App.tsx` | Add `<RecordButton>` to tab bar |

## Out of scope

- Audio recording (microphone) — can be added later
- Converting `.webm` to `.mp4`
- Thumbnail preview after recording
