# Action Capture + Screen Recording — Design Spec

Date: 2026-04-07

## Overview

Extend the existing screen recorder to simultaneously capture system-wide user actions (mouse, keyboard, scroll) and store them in a SQLite database paired with each `.webm` recording. A video player with action timeline overlay will allow reviewing what happened and when.

## Goals

1. Capture system-wide events during any screen recording session
2. Store events in SQLite with millisecond timestamps relative to recording start
3. Video player with action markers on timeline (seek to event on click)
4. Foundation for future E2E test generation

## Out of Scope (this phase)

- Network request capture
- E2E test code generation
- Replay/automation of captured actions

---

## Architecture

### Libraries

- **`uiohook-napi`** — npm package for system-wide mouse/keyboard/scroll via native hook. Rebuilt for Electron ABI via `@electron/rebuild` (same as `node-pty`).
- **`better-sqlite3`** — synchronous SQLite bindings. Also rebuilt for Electron ABI.

### Event Capture Flow

```
startRecording()
  ├── MediaRecorder.start()          → video chunks
  └── uiohook.start()                → raw events → insert into SQLite

stopRecording()
  ├── MediaRecorder.stop()           → flush + save .webm
  └── uiohook.stop()                 → close DB
```

Events are captured in the Electron **main process** (uiohook runs in Node context). Events are written synchronously to SQLite via `better-sqlite3` for reliability.

### Storage Layout

Each recording produces two files with matching names:

```
recordings/
  2026-01-01_12-00-00.webm
  2026-01-01_12-00-00.db
```

### SQLite Schema

```sql
CREATE TABLE events (
  id        INTEGER PRIMARY KEY,
  type      TEXT    NOT NULL,   -- 'mousedown','mouseup','mousemove','keydown','keyup','wheel'
  ts_ms     INTEGER NOT NULL,   -- ms offset from recording startTime
  x         INTEGER,            -- screen coords (mouse events)
  y         INTEGER,
  button    INTEGER,            -- 0=left 1=middle 2=right
  keycode   INTEGER,            -- keydown/keyup
  key_char  TEXT,               -- printable character if available
  modifiers TEXT,               -- JSON: {"ctrl":bool,"shift":bool,"alt":bool,"meta":bool}
  delta_x   REAL,               -- wheel events
  delta_y   REAL
);

CREATE INDEX idx_ts ON events(ts_ms);
```

`ts_ms = event.time - recordingStartEpoch` so it maps directly to video `currentTime * 1000`.

---

## Components

### Main Process: `action-capture.ts`

New module in `apps/desktop/src/`. Responsible for:
- Starting/stopping `uiohook-napi`
- Opening/closing the SQLite database
- Inserting events with correct `ts_ms` offset
- Exposing IPC handlers:
  - `actions:start(dbPath, startTime)` — begin capture
  - `actions:stop()` — flush and close
  - `actions:query(dbPath, fromMs, toMs)` — return events for a time range

### `recorder-manager.ts` (modified)

Two new IPC handlers added alongside existing ones:
- `recorder:sessionStart(cwd)` → main opens SQLite DB, starts uiohook, returns `{ dbPath, startTime }`
- `recorder:sessionStop()` → main stops uiohook, closes DB

`useRecorder` hook calls `sessionStart` before `getUserMedia` and `sessionStop` after `recorder.stop()`.

### Renderer: `useRecorder.ts` (modified)

- On `startRecording`: call `recorder:sessionStart(cwd)` → get `{ dbPath, startTime }`
- On `stopRecording`: call `recorder:sessionStop()` after `recorder.onstop`
- Expose `savedDbPath` alongside `savedPath`

### Renderer: `RecordingPlayer` component (new)

Located at `apps/web/src/components/RecordingPlayer.tsx`.

Props: `{ videoPath: string, dbPath: string }`

Layout:
```
┌─────────────────────────────────────┐
│           <video> element           │
├─────────────────────────────────────┤
│  Timeline bar (duration width)      │
│  ● ● ●  ●●  ●   ●●●  ●             │ ← action markers
│  0s                            60s  │
├─────────────────────────────────────┤
│  Event list (scrollable)            │
│  00:03.2  mousedown  (450, 320)     │
│  00:05.8  keydown    "Enter"        │
└─────────────────────────────────────┘
```

- Markers are colored by type: mouse=blue, keyboard=green, scroll=gray
- Click marker or list item → `video.currentTime = ts_ms / 1000`
- Query events via `actions:query(dbPath, 0, duration_ms)` on mount
- Dense mousemove events (> 60/s) are grouped and shown as a drag gesture

### `RecordingsList.tsx` (modified)

- List item gains a "Play" button → opens `RecordingPlayer` in a modal/drawer
- Pairs `.webm` with `.db` by matching filename stem

---

## macOS Permissions

`uiohook-napi` requires **Accessibility** permission on macOS to capture system-wide input. On first use, prompt user to grant access via System Settings → Privacy & Security → Accessibility. Electron's `systemPreferences.isTrustedAccessibilityClient(true)` triggers the system prompt.

Add to `main.ts` startup:
```ts
if (process.platform === 'darwin') {
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  if (!trusted) {
    // show one-time prompt in renderer: "Grant Accessibility to capture actions"
  }
}
```

---

## Build Changes

`package.json` (desktop):
- Add `uiohook-napi` and `better-sqlite3` to dependencies
- Add both to `@electron/rebuild` postinstall script (already handles `node-pty`)

`.gitignore`: add `recordings/*.db` only if user wants to exclude DB files (optional).

---

## Error Handling

- If Accessibility not granted: uiohook fails to start → recording continues without action capture, show warning toast
- If SQLite write fails mid-session: log error, continue recording, mark DB as incomplete
- If `.db` missing for a `.webm`: `RecordingsList` shows video-only player (no timeline)
