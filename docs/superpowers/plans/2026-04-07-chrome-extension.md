# Chrome Extension Action Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that records tab video + DOM events with rich element context, and sends both to the Electron app via a local HTTP server, replacing the need to guess clicked elements from screenshots.

**Architecture:** A Manifest V3 extension captures DOM events (click, input, keydown, scroll, navigation) via content script with full element context (text, aria-label, selector, XPath, bbox). A background service worker drives the session lifecycle: starts `chrome.tabCapture`, batches events to `localhost:7878/events`, and POSTs the final video blob to `localhost:7878/recording`. Electron's new `chrome-bridge.ts` receives everything, writes a `chrome_events` table into the existing SQLite `.db` file, and saves the `.webm` — the existing RecordingsList and analysis pipeline pick it up automatically.

**Tech Stack:** TypeScript, esbuild, Chrome Extension MV3 (`chrome.tabCapture`, `MediaRecorder`), Node `http` (built-in), `better-sqlite3` (already installed)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/chrome-extension/manifest.json` | Create | MV3 manifest |
| `apps/chrome-extension/package.json` | Create | esbuild build |
| `apps/chrome-extension/tsconfig.json` | Create | TS config |
| `apps/chrome-extension/popup.html` | Create | Popup markup |
| `apps/chrome-extension/src/types.ts` | Create | Shared `ChromeEvent` type |
| `apps/chrome-extension/src/content-script.ts` | Create | DOM event capture + element context |
| `apps/chrome-extension/src/background.ts` | Create | Session, tabCapture, HTTP client |
| `apps/chrome-extension/src/popup.ts` | Create | Popup UI logic |
| `apps/desktop/src/chrome-bridge.ts` | Create | HTTP server, SQLite writer, IPC emitter |
| `apps/desktop/src/main.ts` | Modify | Start chrome-bridge, add `chrome:setActiveCwd` IPC |
| `apps/desktop/src/preload.ts` | Modify | Add `ChromeEvent` type, `recorder.queryChrome`, `chrome.setActiveCwd`, `recorder.onFileListChanged` |
| `apps/desktop/src/recorder-manager.ts` | Modify | Add `recorder:queryChrome` IPC handler |
| `apps/web/src/components/RecordingPlayer.tsx` | Modify | Load + display chrome_events, enrich analyze.md rows |
| `apps/web/src/electron.d.ts` | Modify (if exists) | Keep in sync with preload types |
| `turbo.json` | Modify | Add `chrome-extension` build task |

---

## Task 1: Chrome Extension — Package + Build Setup

**Files:**
- Create: `apps/chrome-extension/package.json`
- Create: `apps/chrome-extension/tsconfig.json`
- Create: `apps/chrome-extension/manifest.json`
- Create: `apps/chrome-extension/popup.html`
- Modify: `turbo.json`

- [ ] **Step 1: Create `apps/chrome-extension/package.json`**

```json
{
  "name": "@e2e-code/chrome-extension",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "build": "node build.mjs",
    "dev": "node build.mjs --watch",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.324",
    "@types/node": "catalog:",
    "esbuild": "^0.25.0",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create `apps/chrome-extension/build.mjs`**

```js
import * as esbuild from "esbuild";
import * as fs from "node:fs";

const watch = process.argv.includes("--watch");

const entryPoints = [
  { in: "src/content-script.ts", out: "dist/content-script" },
  { in: "src/background.ts",     out: "dist/background" },
  { in: "src/popup.ts",          out: "dist/popup" },
];

const ctx = await esbuild.context({
  entryPoints,
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
});

if (watch) {
  await ctx.watch();
  console.log("Watching...");
} else {
  await ctx.rebuild();
  ctx.dispose();

  // Copy static files to dist/
  fs.copyFileSync("manifest.json", "dist/manifest.json");
  fs.copyFileSync("popup.html",    "dist/popup.html");

  // Copy icons if present
  if (fs.existsSync("icons")) {
    fs.mkdirSync("dist/icons", { recursive: true });
    for (const f of fs.readdirSync("icons")) {
      fs.copyFileSync(`icons/${f}`, `dist/icons/${f}`);
    }
  }
  console.log("Build complete → dist/");
}
```

- [ ] **Step 3: Create `apps/chrome-extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "types": ["chrome"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 4: Create `apps/chrome-extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "e2e-code Recorder",
  "version": "1.0.0",
  "description": "Record tab actions with DOM context for AI-assisted E2E test generation",
  "permissions": ["tabCapture", "storage"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_idle",
    "all_frames": false
  }],
  "action": {
    "default_popup": "popup.html",
    "default_title": "e2e-code Recorder"
  }
}
```

- [ ] **Step 5: Create `apps/chrome-extension/popup.html`**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 220px;
    font-family: -apple-system, sans-serif;
    background: #0d1117;
    color: #e6edf3;
    padding: 12px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #8b949e;
    margin-bottom: 10px;
  }
  .dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #30363d;
    flex-shrink: 0;
  }
  .dot.connected { background: #3fb950; }
  .dot.recording { background: #f85149; animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
  .timer { font-size: 11px; color: #8b949e; margin-bottom: 10px; font-variant-numeric: tabular-nums; }
  button {
    width: 100%;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid #30363d;
    background: #21262d;
    color: #e6edf3;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover { background: #30363d; }
  button.start { border-color: #388bfd; color: #388bfd; }
  button.stop  { border-color: #f85149; color: #f85149; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .events { font-size: 10px; color: #6e7681; margin-top: 8px; }
</style>
</head>
<body>
  <div class="status">
    <div class="dot" id="conn-dot"></div>
    <span id="conn-label">Checking connection…</span>
  </div>
  <div class="timer" id="timer" style="display:none"></div>
  <button id="btn" disabled>Start Recording</button>
  <div class="events" id="event-count"></div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 6: Add `chrome-extension` to turbo.json**

In `turbo.json`, add to the `tasks` object:
```json
"build": {
  "dependsOn": ["^build"],
  "outputs": ["dist/**"]
}
```

The full `turbo.json` becomes:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": [
    "PORT",
    "VITE_DEV_SERVER_URL",
    "ELECTRON_RENDERER_PORT"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist-electron/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": [],
      "cache": false
    }
  }
}
```

- [ ] **Step 7: Install dependencies and verify build scaffolding**

```bash
cd /Users/cuongpham/ws/automation
bun install
cd apps/chrome-extension
mkdir -p src dist
```

- [ ] **Step 8: Commit**

```bash
git add apps/chrome-extension/ turbo.json
git commit -m "feat: scaffold chrome-extension package with esbuild build"
```

---

## Task 2: Shared Types

**Files:**
- Create: `apps/chrome-extension/src/types.ts`

- [ ] **Step 1: Create `apps/chrome-extension/src/types.ts`**

```typescript
export interface ElementContext {
  tag: string;
  id: string | null;
  text: string | null;         // trimmed textContent, max 80 chars
  aria_label: string | null;
  role: string | null;
  placeholder: string | null;
  data_testid: string | null;  // data-testid | data-cy | data-e2e, first found
  selector: string;            // best CSS selector
  xpath: string;               // absolute XPath
  classes: string[];
  bbox: { x: number; y: number; width: number; height: number };
}

export type ChromeEventType = "click" | "input" | "keydown" | "scroll" | "navigation";

export interface ChromeEvent {
  type: ChromeEventType;
  ts_ms: number;              // Date.now() - sessionStartTime
  x: number | null;
  y: number | null;
  url: string;
  page_title: string;
  element: ElementContext | null;
  input_value: string | null; // for input events: final value
  key_combo: string | null;   // for keydown: "Cmd+S", "Enter", "Tab", etc.
  scroll_dir: "up" | "down" | null;
  nav_from: string | null;
  nav_to: string | null;
}

// Message types between content script and background
export type ContentMessage =
  | { kind: "event"; event: ChromeEvent }
  | { kind: "session_start_time"; startTime: number };
```

- [ ] **Step 2: Commit**

```bash
git add apps/chrome-extension/src/types.ts
git commit -m "feat: add ChromeEvent shared types for chrome extension"
```

---

## Task 3: Content Script — DOM Event Capture

**Files:**
- Create: `apps/chrome-extension/src/content-script.ts`

- [ ] **Step 1: Create `apps/chrome-extension/src/content-script.ts`**

```typescript
import type { ChromeEvent, ElementContext, ContentMessage } from "./types";

let sessionStartTime: number | null = null;

// Receive start time from background when session begins
chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
  if (msg.kind === "session_start_time") {
    sessionStartTime = msg.startTime;
  }
});

function tsMs(): number {
  if (sessionStartTime === null) return 0;
  return Date.now() - sessionStartTime;
}

function send(event: ChromeEvent): void {
  chrome.runtime.sendMessage({ kind: "event", event } satisfies ContentMessage);
}

// --- Element context extraction ---

function getImplicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const map: Record<string, string> = {
    button: "button", a: "link", input: "textbox",
    select: "listbox", textarea: "textbox", nav: "navigation",
    main: "main", header: "banner", footer: "contentinfo",
  };
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
  }
  return map[tag] ?? null;
}

function getBestSelector(el: Element): string {
  // Priority: data-testid → aria-label → id → role+text → CSS
  const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-cy") ?? el.getAttribute("data-e2e");
  if (testid) return `[data-testid="${CSS.escape(testid)}"]`;

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

  const id = el.id;
  if (id && !/^\d/.test(id) && !id.includes(":")) return `#${CSS.escape(id)}`;

  // Walk up DOM to find shortest unique CSS selector
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id && !/^\d/.test(node.id)) {
      part = `#${CSS.escape(node.id)}`;
      parts.unshift(part);
      break;
    }
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (s) => s.tagName === node!.tagName,
    );
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
    // Stop if already unique
    if (parts.length >= 2 && document.querySelectorAll(parts.join(" > ")).length === 1) break;
  }
  return parts.join(" > ");
}

function getXPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (s) => s.tagName === node!.tagName,
    );
    const idx = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : "";
    parts.unshift(`${tag}${idx}`);
    node = node.parentElement;
  }
  return `//${parts.join("/")}`;
}

function getElementContext(el: Element): ElementContext {
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();

  const testid =
    el.getAttribute("data-testid") ??
    el.getAttribute("data-cy") ??
    el.getAttribute("data-e2e") ??
    null;

  // Get meaningful text: prefer aria-label, then textContent (trimmed, max 80)
  const rawText = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? null;

  // Filter out utility/generated class names
  const classes = Array.from(el.classList).filter(
    (c) => !/^(css-|sc-|_|tw-|bg-|text-|px-|py-|mx-|my-|flex|grid|w-|h-|rounded|border|hover:|focus:)/.test(c),
  ).slice(0, 5);

  return {
    tag,
    id: el.id || null,
    text: rawText || null,
    aria_label: el.getAttribute("aria-label"),
    role: el.getAttribute("role") ?? getImplicitRole(el),
    placeholder: (el as HTMLInputElement).placeholder || null,
    data_testid: testid,
    selector: getBestSelector(el),
    xpath: getXPath(el),
    classes,
    bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

// --- Event listeners ---

document.addEventListener("mousedown", (e) => {
  const target = e.target as Element | null;
  if (!target || target === document.body || target === document.documentElement) return;

  // Walk up to find meaningful interactive element
  let el: Element | null = target;
  while (el && el !== document.body) {
    const tag = el.tagName.toLowerCase();
    if (["a", "button", "input", "select", "textarea", "label", "tr", "td", "li"].includes(tag)) break;
    if (el.getAttribute("role") || el.getAttribute("aria-label") || el.getAttribute("data-testid")) break;
    if (el.getAttribute("onclick") !== null) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) el = target;

  send({
    type: "click",
    ts_ms: tsMs(),
    x: Math.round(e.clientX),
    y: Math.round(e.clientY),
    url: location.href,
    page_title: document.title,
    element: getElementContext(el),
    input_value: null,
    key_combo: null,
    scroll_dir: null,
    nav_from: null,
    nav_to: null,
  });
}, { capture: true, passive: true });

// Input: debounced, capture final value
const inputTimers = new WeakMap<EventTarget, ReturnType<typeof setTimeout>>();
document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  const existing = inputTimers.get(target);
  if (existing) clearTimeout(existing);
  inputTimers.set(target, setTimeout(() => {
    send({
      type: "input",
      ts_ms: tsMs(),
      x: null, y: null,
      url: location.href,
      page_title: document.title,
      element: getElementContext(target),
      input_value: target.value ?? null,
      key_combo: null,
      scroll_dir: null,
      nav_from: null,
      nav_to: null,
    });
  }, 400));
}, { capture: true, passive: true });

// Keydown: shortcuts only (Cmd+, Ctrl+, special keys)
document.addEventListener("keydown", (e) => {
  const isShortcut = e.metaKey || e.ctrlKey || e.altKey;
  const isSpecial = ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F1", "F2", "F3", "F4", "F5"].includes(e.key);
  if (!isShortcut && !isSpecial) return;

  const parts: string[] = [];
  if (e.metaKey)  parts.push("Cmd");
  if (e.ctrlKey)  parts.push("Ctrl");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const combo = parts.join("+");

  const target = e.target as Element | null;
  send({
    type: "keydown",
    ts_ms: tsMs(),
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: target && target !== document.body ? getElementContext(target) : null,
    input_value: null,
    key_combo: combo,
    scroll_dir: null,
    nav_from: null,
    nav_to: null,
  });
}, { capture: true, passive: true });

// Scroll: throttled, 200ms
let lastScrollMs = 0;
document.addEventListener("scroll", (e) => {
  const now = Date.now();
  if (sessionStartTime && now - (sessionStartTime + lastScrollMs) < 200) return;
  lastScrollMs = tsMs();

  const target = e.target as Element | null;
  const deltaY = target ? (target as Element & { scrollTop?: number }).scrollTop ?? 0 : window.scrollY;
  send({
    type: "scroll",
    ts_ms: lastScrollMs,
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: target && target !== document && target !== document.body ? getElementContext(target as Element) : null,
    input_value: null,
    key_combo: null,
    scroll_dir: deltaY > 0 ? "down" : "up",
    nav_from: null,
    nav_to: null,
  });
}, { capture: true, passive: true });

// Navigation: hook pushState + popstate
const originalPushState = history.pushState.bind(history);
history.pushState = function (...args) {
  const from = location.href;
  originalPushState(...args);
  send({
    type: "navigation",
    ts_ms: tsMs(),
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: null,
    input_value: null,
    key_combo: null,
    scroll_dir: null,
    nav_from: from,
    nav_to: location.href,
  });
};

window.addEventListener("popstate", () => {
  send({
    type: "navigation",
    ts_ms: tsMs(),
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: null,
    input_value: null,
    key_combo: null,
    scroll_dir: null,
    nav_from: null,
    nav_to: location.href,
  });
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: 0 errors for `chrome-extension`

- [ ] **Step 3: Commit**

```bash
git add apps/chrome-extension/src/
git commit -m "feat: add chrome extension content script with element context capture"
```

---

## Task 4: Background Service Worker

**Files:**
- Create: `apps/chrome-extension/src/background.ts`

- [ ] **Step 1: Create `apps/chrome-extension/src/background.ts`**

```typescript
import type { ChromeEvent, ContentMessage } from "./types";

const BRIDGE_URL = "http://localhost:7878";
const BATCH_INTERVAL_MS = 500;
const MAX_BUFFER = 1000;

interface SessionState {
  sessionId: string;
  startTime: number;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  timerInterval: ReturnType<typeof setInterval> | null;
  elapsedSeconds: number;
}

let session: SessionState | null = null;
let eventBuffer: ChromeEvent[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;

// --- HTTP helpers ---

async function isConnected(): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function postJSON(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

async function postBinary(path: string, blob: Blob, sessionId: string): Promise<Response | null> {
  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "video/webm",
        "X-Session-Id": sessionId,
      },
      body: blob,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    return null;
  }
}

// --- Event batching ---

function startBatchTimer(): void {
  if (batchTimer) return;
  batchTimer = setInterval(flushEvents, BATCH_INTERVAL_MS);
}

function stopBatchTimer(): void {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
}

async function flushEvents(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0, eventBuffer.length);
  await postJSON("/events", { sessionId: session?.sessionId, events: batch });
}

// --- Session lifecycle ---

async function startSession(tabId: number): Promise<{ ok: boolean; error?: string }> {
  const connected = await isConnected();
  if (!connected) return { ok: false, error: "Cannot reach Electron app on localhost:7878" };

  // Start tab capture
  const stream = await new Promise<MediaStream | null>((resolve) => {
    chrome.tabCapture.capture({ video: true, audio: false }, (s) => resolve(s ?? null));
  });
  if (!stream) return { ok: false, error: "tabCapture failed — is the tab active?" };

  // Start session on Electron side
  const res = await postJSON("/session/start", {});
  if (!res || !res.ok) {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, error: "Electron rejected session start" };
  }
  const { sessionId, startTime } = await res.json() as { sessionId: string; startTime: number };

  // Set up MediaRecorder
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  session = {
    sessionId, startTime, stream, recorder, chunks,
    timerInterval: null, elapsedSeconds: 0,
  };

  recorder.start(1000); // collect chunks every second

  // Tell all content scripts the start time so ts_ms offsets are correct
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { kind: "session_start_time", startTime } satisfies ContentMessage)
        .catch(() => {}); // ignore tabs without content script
    }
  }

  // Start batching events
  eventBuffer = [];
  startBatchTimer();

  // Start elapsed timer
  session.timerInterval = setInterval(() => {
    session!.elapsedSeconds++;
    chrome.storage.session.set({ elapsedSeconds: session!.elapsedSeconds });
  }, 1000);

  chrome.storage.session.set({ recording: true, elapsedSeconds: 0 });
  return { ok: true };
}

async function stopSession(): Promise<void> {
  if (!session) return;
  const { sessionId, stream, recorder, chunks, timerInterval } = session;

  if (timerInterval) clearInterval(timerInterval);
  stopBatchTimer();
  await flushEvents(); // flush remaining events

  // Stop recorder and collect final blob
  await new Promise<void>((resolve) => {
    recorder!.onstop = () => resolve();
    recorder!.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: "video/webm" });

  // Notify Electron session is stopping (so it can finalize DB)
  await postJSON("/session/stop", { sessionId });

  // Send video
  await postBinary("/recording", blob, sessionId);

  session = null;
  chrome.storage.session.set({ recording: false, elapsedSeconds: 0 });
}

// --- Message handler from content scripts ---

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, _sendResponse) => {
  if (msg.kind === "event" && session) {
    if (eventBuffer.length < MAX_BUFFER) {
      eventBuffer.push(msg.event);
    }
  }
});

// --- External messages from popup ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;

  // Send current state immediately
  chrome.storage.session.get(["recording", "elapsedSeconds"]).then((s) => {
    port.postMessage({ type: "state", recording: s["recording"] ?? false, elapsedSeconds: s["elapsedSeconds"] ?? 0 });
  });

  isConnected().then((ok) => port.postMessage({ type: "connected", ok }));

  port.onMessage.addListener(async (msg: { action: "start" | "stop"; tabId?: number }) => {
    if (msg.action === "start" && msg.tabId != null) {
      const result = await startSession(msg.tabId);
      port.postMessage({ type: "start_result", ...result });
    }
    if (msg.action === "stop") {
      await stopSession();
      port.postMessage({ type: "stopped" });
    }
  });
});
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/chrome-extension/src/background.ts
git commit -m "feat: add chrome extension background service worker with tabCapture and HTTP client"
```

---

## Task 5: Popup UI

**Files:**
- Create: `apps/chrome-extension/src/popup.ts`

- [ ] **Step 1: Create `apps/chrome-extension/src/popup.ts`**

```typescript
const btn = document.getElementById("btn") as HTMLButtonElement;
const connDot = document.getElementById("conn-dot") as HTMLDivElement;
const connLabel = document.getElementById("conn-label") as HTMLSpanElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const eventCountEl = document.getElementById("event-count") as HTMLDivElement;

let recording = false;
let elapsedSeconds = 0;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function updateUI(): void {
  if (recording) {
    btn.textContent = "Stop Recording";
    btn.className = "stop";
    timerEl.style.display = "block";
    timerEl.textContent = `● ${formatTime(elapsedSeconds)}`;
    connDot.className = "dot recording";
    connLabel.textContent = "Recording…";
  } else {
    btn.textContent = "Start Recording";
    btn.className = "start";
    timerEl.style.display = "none";
    connDot.className = "dot";
    connLabel.textContent = "Not recording";
  }
}

const port = chrome.runtime.connect({ name: "popup" });

port.onMessage.addListener((msg: { type: string; ok?: boolean; recording?: boolean; elapsedSeconds?: number; error?: string }) => {
  if (msg.type === "connected") {
    if (msg.ok) {
      connDot.classList.add("connected");
      connLabel.textContent = recording ? "Recording…" : "Connected to e2e-code";
      btn.disabled = false;
    } else {
      connDot.className = "dot";
      connLabel.textContent = "e2e-code app not running";
      btn.disabled = true;
    }
  }
  if (msg.type === "state") {
    recording = msg.recording ?? false;
    elapsedSeconds = msg.elapsedSeconds ?? 0;
    updateUI();
  }
  if (msg.type === "start_result") {
    if (!msg.ok) {
      connLabel.textContent = msg.error ?? "Failed to start";
      btn.disabled = false;
    }
  }
  if (msg.type === "stopped") {
    connLabel.textContent = "Saved — check e2e-code app";
  }
});

// Tick elapsed timer locally
setInterval(() => {
  if (recording) {
    elapsedSeconds++;
    timerEl.textContent = `● ${formatTime(elapsedSeconds)}`;
  }
}, 1000);

btn.addEventListener("click", async () => {
  btn.disabled = true;
  if (!recording) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    port.postMessage({ action: "start", tabId: tab?.id });
    recording = true;
    elapsedSeconds = 0;
    updateUI();
  } else {
    port.postMessage({ action: "stop" });
    recording = false;
    updateUI();
    connLabel.textContent = "Saving…";
  }
  btn.disabled = false;
});

updateUI();
```

- [ ] **Step 2: Build the extension**

```bash
cd /Users/cuongpham/ws/automation/apps/chrome-extension
bun install
node build.mjs
```

Expected output:
```
Build complete → dist/
```

Verify `dist/` contains: `content-script.js`, `background.js`, `popup.js`, `popup.html`, `manifest.json`

- [ ] **Step 3: Load extension in Chrome and verify**

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `apps/chrome-extension/dist/`
4. Extension appears with "e2e-code Recorder" name
5. Click extension icon → popup shows with "e2e-code app not running" (Electron not running yet — expected)

- [ ] **Step 4: Commit**

```bash
git add apps/chrome-extension/src/popup.ts
git commit -m "feat: add chrome extension popup UI with start/stop and connection status"
```

---

## Task 6: Electron — chrome-bridge HTTP Server

**Files:**
- Create: `apps/desktop/src/chrome-bridge.ts`

- [ ] **Step 1: Create `apps/desktop/src/chrome-bridge.ts`**

```typescript
import * as http from "node:http";
import * as FS from "node:fs";
import * as Path from "node:path";
import Database from "better-sqlite3";
import { BrowserWindow } from "electron";

interface SessionState {
  sessionId: string;
  startTime: number;
  stemDir: string;
  dbPath: string;
  db: Database.Database;
  insertChrome: Database.Statement;
}

let activeCwd: string | null = null;
let session: SessionState | null = null;
let server: http.Server | null = null;
let getMainWindowFn: (() => BrowserWindow | null) | null = null;

export function setActiveCwd(cwd: string): void {
  activeCwd = cwd;
}

function openChromeDb(dbPath: string): { db: Database.Database; insertChrome: Database.Statement } {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chrome_events (
      id             INTEGER PRIMARY KEY,
      type           TEXT    NOT NULL,
      ts_ms          INTEGER NOT NULL,
      x              INTEGER,
      y              INTEGER,
      url            TEXT,
      page_title     TEXT,
      el_tag         TEXT,
      el_id          TEXT,
      el_text        TEXT,
      el_aria_label  TEXT,
      el_role        TEXT,
      el_placeholder TEXT,
      el_testid      TEXT,
      el_selector    TEXT,
      el_xpath       TEXT,
      el_classes     TEXT,
      el_bbox        TEXT,
      input_value    TEXT,
      key_combo      TEXT,
      scroll_dir     TEXT,
      nav_from       TEXT,
      nav_to         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chrome_ts ON chrome_events(ts_ms);
  `);
  const insertChrome = db.prepare(`
    INSERT INTO chrome_events (
      type, ts_ms, x, y, url, page_title,
      el_tag, el_id, el_text, el_aria_label, el_role, el_placeholder, el_testid,
      el_selector, el_xpath, el_classes, el_bbox,
      input_value, key_combo, scroll_dir, nav_from, nav_to
    ) VALUES (
      @type, @ts_ms, @x, @y, @url, @page_title,
      @el_tag, @el_id, @el_text, @el_aria_label, @el_role, @el_placeholder, @el_testid,
      @el_selector, @el_xpath, @el_classes, @el_bbox,
      @input_value, @key_combo, @scroll_dir, @nav_from, @nav_to
    )
  `);
  return { db, insertChrome };
}

function insertEvents(events: unknown[]): void {
  if (!session) return;
  const insertMany = session.db.transaction((rows: unknown[]) => {
    for (const raw of rows) {
      const e = raw as {
        type: string; ts_ms: number; x?: number | null; y?: number | null;
        url?: string; page_title?: string;
        element?: {
          tag?: string; id?: string; text?: string; aria_label?: string;
          role?: string; placeholder?: string; data_testid?: string;
          selector?: string; xpath?: string; classes?: string[];
          bbox?: { x: number; y: number; width: number; height: number };
        } | null;
        input_value?: string | null;
        key_combo?: string | null;
        scroll_dir?: string | null;
        nav_from?: string | null;
        nav_to?: string | null;
      };
      session!.insertChrome.run({
        type: e.type,
        ts_ms: e.ts_ms,
        x: e.x ?? null,
        y: e.y ?? null,
        url: e.url ?? null,
        page_title: e.page_title ?? null,
        el_tag: e.element?.tag ?? null,
        el_id: e.element?.id ?? null,
        el_text: e.element?.text ?? null,
        el_aria_label: e.element?.aria_label ?? null,
        el_role: e.element?.role ?? null,
        el_placeholder: e.element?.placeholder ?? null,
        el_testid: e.element?.data_testid ?? null,
        el_selector: e.element?.selector ?? null,
        el_xpath: e.element?.xpath ?? null,
        el_classes: e.element?.classes ? JSON.stringify(e.element.classes) : null,
        el_bbox: e.element?.bbox ? JSON.stringify(e.element.bbox) : null,
        input_value: e.input_value ?? null,
        key_combo: e.key_combo ?? null,
        scroll_dir: e.scroll_dir ?? null,
        nav_from: e.nav_from ?? null,
        nav_to: e.nav_to ?? null,
      });
    }
  });
  try { insertMany(events); } catch (err) { console.error("[chrome-bridge] insert error:", err); }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
  });
  res.end(json);
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Session-Id", "Access-Control-Allow-Methods": "GET, POST" });
    res.end();
    return;
  }

  const url = req.url ?? "/";

  // GET /status
  if (req.method === "GET" && url === "/status") {
    jsonResponse(res, 200, {
      active: session !== null,
      sessionId: session?.sessionId ?? null,
      startTime: session?.startTime ?? null,
      cwd: activeCwd,
    });
    return;
  }

  // POST /session/start
  if (req.method === "POST" && url === "/session/start") {
    if (session) {
      jsonResponse(res, 409, { error: "Session already active" });
      return;
    }
    const cwd = activeCwd ?? Path.join(process.env["HOME"] ?? "/tmp", "recordings");
    const dir = Path.join(cwd, "recordings");
    FS.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const stem = ts;
    const stemDir = Path.join(dir, stem);
    const dbPath = Path.join(dir, `${stem}.db`);
    FS.mkdirSync(stemDir, { recursive: true });
    const startTime = Date.now();
    const sessionId = `chrome-${stem}`;
    const { db, insertChrome } = openChromeDb(dbPath);
    session = { sessionId, startTime, stemDir, dbPath, db, insertChrome };
    jsonResponse(res, 200, { sessionId, startTime, stem });
    return;
  }

  // POST /session/stop
  if (req.method === "POST" && url === "/session/stop") {
    if (session) {
      try { session.db.close(); } catch {}
      session = null;
    }
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // POST /events
  if (req.method === "POST" && url === "/events") {
    readBody(req).then((buf) => {
      try {
        const body = JSON.parse(buf.toString()) as { events: unknown[] };
        insertEvents(body.events ?? []);
        jsonResponse(res, 200, { ok: true });
      } catch (err) {
        jsonResponse(res, 400, { error: String(err) });
      }
    }).catch(() => jsonResponse(res, 500, { error: "read error" }));
    return;
  }

  // POST /recording  (binary webm blob)
  if (req.method === "POST" && url === "/recording") {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    // Determine stem from session or session id
    const stem = sessionId?.replace("chrome-", "") ?? new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const cwd = activeCwd ?? Path.join(process.env["HOME"] ?? "/tmp", "recordings");
    const webmPath = Path.join(cwd, "recordings", `${stem}.webm`);

    readBody(req).then((buf) => {
      FS.writeFile(webmPath, buf, (err) => {
        if (err) { jsonResponse(res, 500, { error: String(err) }); return; }
        jsonResponse(res, 200, { ok: true, path: webmPath });
        // Notify renderer to refresh list
        const win = getMainWindowFn?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send("recorder:fileListChanged");
        }
      });
    }).catch(() => jsonResponse(res, 500, { error: "read error" }));
    return;
  }

  jsonResponse(res, 404, { error: "Not found" });
}

export function startChromeBridge(getMainWindow: () => BrowserWindow | null): void {
  getMainWindowFn = getMainWindow;
  server = http.createServer(handleRequest);
  server.listen(7878, "127.0.0.1", () => {
    console.log("[chrome-bridge] listening on localhost:7878");
  });
  server.on("error", (err) => {
    console.error("[chrome-bridge] server error:", err);
  });
}

export function stopChromeBridge(): void {
  if (session) {
    try { session.db.close(); } catch {}
    session = null;
  }
  server?.close();
  server = null;
}

export function queryChromeEvents(dbPath: string, fromMs: number, toMs: number): unknown[] {
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare("SELECT * FROM chrome_events WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms")
      .all(fromMs, toMs);
    db.close();
    return rows;
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/chrome-bridge.ts
git commit -m "feat: add chrome-bridge HTTP server for receiving extension events and video"
```

---

## Task 7: Wire chrome-bridge into Electron main + IPC

**Files:**
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/recorder-manager.ts`

- [ ] **Step 1: Add chrome-bridge to `apps/desktop/src/main.ts`**

Add the import at the top alongside existing imports:
```typescript
import { startChromeBridge, stopChromeBridge, setActiveCwd } from "./chrome-bridge";
```

Inside `app.whenReady().then(...)`, after `registerActionCaptureHandlers()`:
```typescript
  startChromeBridge(() => mainWindow);

  // Allow renderer to set the active project cwd for chrome recordings
  ipcMain.handle("chrome:setActiveCwd", (_event, cwd: string) => {
    setActiveCwd(cwd);
  });
```

Inside `app.on("before-quit", ...)`:
```typescript
  stopChromeBridge();
```

- [ ] **Step 2: Add `recorder:queryChrome` to `apps/desktop/src/recorder-manager.ts`**

At the top, add import:
```typescript
import { queryChromeEvents } from "./chrome-bridge";
```

Inside `registerRecorderHandlers`, add after the existing `recorder:listFiles` handler:
```typescript
  // --- queryChrome ---
  ipcMain.handle("recorder:queryChrome", (_event, dbPath: string, fromMs: number, toMs: number) => {
    if (!dbPath || !Path.isAbsolute(dbPath)) return [];
    return queryChromeEvents(dbPath, fromMs, toMs);
  });
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main.ts apps/desktop/src/recorder-manager.ts
git commit -m "feat: wire chrome-bridge into Electron main process and add queryChrome IPC"
```

---

## Task 8: Preload + Type Updates

**Files:**
- Modify: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Add `ChromeEvent` interface to `apps/desktop/src/preload.ts`**

After the existing `FrameEntry` interface, add:
```typescript
export interface ChromeEvent {
  id: number;
  type: string;
  ts_ms: number;
  x: number | null;
  y: number | null;
  url: string | null;
  page_title: string | null;
  el_tag: string | null;
  el_id: string | null;
  el_text: string | null;
  el_aria_label: string | null;
  el_role: string | null;
  el_placeholder: string | null;
  el_testid: string | null;
  el_selector: string | null;
  el_xpath: string | null;
  el_classes: string | null;   // JSON array string
  el_bbox: string | null;      // JSON {x,y,width,height} string
  input_value: string | null;
  key_combo: string | null;
  scroll_dir: string | null;
  nav_from: string | null;
  nav_to: string | null;
}
```

- [ ] **Step 2: Add new methods to `ElectronAPI` in `preload.ts`**

In the `recorder` section of `ElectronAPI`, add:
```typescript
    queryChrome(dbPath: string, fromMs: number, toMs: number): Promise<ChromeEvent[]>;
    onFileListChanged(callback: () => void): () => void;
```

In the `ElectronAPI`, add a new top-level `chrome` section:
```typescript
  chrome: {
    setActiveCwd(cwd: string): Promise<void>;
  };
```

- [ ] **Step 3: Add implementations to the `api` object in `preload.ts`**

In the `recorder` section:
```typescript
    queryChrome: (dbPath: string, fromMs: number, toMs: number) =>
      ipcRenderer.invoke("recorder:queryChrome", dbPath, fromMs, toMs),
    onFileListChanged: (callback: () => void) =>
      onChannel("recorder:fileListChanged", callback),
```

Add the `chrome` section to `api`:
```typescript
  chrome: {
    setActiveCwd: (cwd: string) => ipcRenderer.invoke("chrome:setActiveCwd", cwd),
  },
```

- [ ] **Step 4: Check `apps/web/src/electron.d.ts` exists and sync if needed**

```bash
ls /Users/cuongpham/ws/automation/apps/web/src/electron.d.ts
```

If it exists, open it and add the same `ChromeEvent` interface and new method signatures to keep it in sync with `preload.ts`.

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/preload.ts apps/web/src/electron.d.ts
git commit -m "feat: add ChromeEvent type and queryChrome/onFileListChanged to ElectronAPI"
```

---

## Task 9: RecordingPlayer — Use chrome_events

**Files:**
- Modify: `apps/web/src/components/RecordingPlayer.tsx`

- [ ] **Step 1: Load chrome_events in `RecordingPlayer`**

In `RecordingPlayer.tsx`, add `chromeEvents` state alongside `events`:

```typescript
const [chromeEvents, setChromeEvents] = useState<ChromeEvent[]>([]);
```

In `handleMetadata`, after `setEvents(evts)`, load chrome events if a `.db` exists:

```typescript
  const handleMetadata = useCallback(async () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(d * 1000);
    if (!dbPath) return;
    const evts = await window.electronAPI.recorder.queryActions(dbPath, 0, d * 1000);
    setEvents(evts);
    const cevts = await window.electronAPI.recorder.queryChrome(dbPath, 0, d * 1000);
    setChromeEvents(cevts);
  }, [dbPath]);
```

- [ ] **Step 2: Show rich labels in the event list**

In the event list render section, replace the existing `describeEvent(ev)` call with a helper that first checks for a matching chrome event:

```typescript
function getRichLabel(ev: ActionEvent, chromeEvents: ChromeEvent[]): string {
  // Find chrome event within ±100ms
  const ce = chromeEvents.find((c) => Math.abs(c.ts_ms - ev.ts_ms) <= 100);
  if (!ce) return describeEvent(ev);

  if (ce.type === "navigation") return `→ ${ce.nav_to ?? ce.url ?? ""}`;
  if (ce.type === "keydown" && ce.key_combo) return ce.key_combo;
  if (ce.type === "input" && ce.input_value != null) {
    const label = ce.el_aria_label ?? ce.el_placeholder ?? ce.el_tag ?? "input";
    return `"${ce.input_value}" → ${label}`;
  }
  if (ce.type === "click") {
    const label = ce.el_text ?? ce.el_aria_label ?? ce.el_testid ?? ce.el_id ?? ce.el_tag ?? "element";
    const selector = ce.el_testid ? `[data-testid="${ce.el_testid}"]` : (ce.el_id ? `#${ce.el_id}` : (ce.el_selector ?? ""));
    return `${label}${selector ? `  ${selector}` : ""}`;
  }
  return describeEvent(ev);
}
```

Replace the event list item's description span:
```tsx
<span className="text-[10px] text-[#6e7681] truncate">
  {getRichLabel(ev, chromeEvents)}
</span>
```

- [ ] **Step 3: Enrich `analyze.md` rows with chrome event data**

In `handleAnalyze`, after getting `keyEvents`, build rows using chrome context when available:

```typescript
      for (let i = 0; i < keyEvents.length; i++) {
        const ev = keyEvents[i]!;
        const framePath = `${framesDir}/frame-${ev.ts_ms}.jpg`;
        const buffer = await extractFrame(videoRef.current, canvasRef.current, ev.ts_ms);
        await window.electronAPI.recorder.saveFrame(framePath, buffer);

        const relFrame = `recordings/${stem}/frames/frame-${ev.ts_ms}.jpg`;

        // Try to enrich with chrome event context
        const ce = chromeEvents.find((c) => Math.abs(c.ts_ms - ev.ts_ms) <= 100);
        let detail: string;
        if (ce) {
          if (ce.type === "navigation") {
            detail = `navigation → ${ce.nav_to ?? ce.url ?? ""}`;
          } else if (ce.type === "keydown" && ce.key_combo) {
            detail = `key ${ce.key_combo}`;
          } else if (ce.type === "input" && ce.input_value != null) {
            const label = ce.el_aria_label ?? ce.el_placeholder ?? ce.el_tag ?? "input";
            detail = `typed "${ce.input_value}" in ${label} [${ce.el_selector ?? ""}]`;
          } else {
            const label = ce.el_text ?? ce.el_aria_label ?? ce.el_testid ?? ce.el_id ?? ce.el_tag ?? "element";
            const selector = ce.el_testid ? `[data-testid="${ce.el_testid}"]` : (ce.el_id ? `#${ce.el_id}` : (ce.el_selector ?? ""));
            detail = `${label}${selector ? ` [${selector}]` : ""}`;
          }
        } else {
          detail = describeEvent(ev);
        }

        rows.push(`| ${i + 1} | ${formatMs(ev.ts_ms)} | ${ev.type} | ${detail} | ${relFrame} |`);
      }
```

- [ ] **Step 4: Subscribe to `onFileListChanged` to refresh list after chrome recording**

In whichever parent component holds `refreshKey` for `RecordingsList`, add:
```typescript
  useEffect(() => {
    const off = window.electronAPI.recorder.onFileListChanged(() => {
      setRefreshKey((k) => k + 1);
    });
    return off;
  }, []);
```

Find the parent component file (the one that renders `<RecordingsList refreshKey={...}>`), and add the above effect.

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/cuongpham/ws/automation
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/RecordingPlayer.tsx
git commit -m "feat: enrich RecordingPlayer event list and analyze.md with chrome_events context"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 1: Start Electron dev server**

```bash
cd /Users/cuongpham/ws/automation
bun run dev
```

Expected: Electron app opens, terminal loads

- [ ] **Step 2: Verify chrome-bridge is listening**

In a separate terminal:
```bash
curl http://localhost:7878/status
```

Expected:
```json
{"active":false,"sessionId":null,"startTime":null,"cwd":null}
```

- [ ] **Step 3: Open a project in the Electron app and verify cwd propagation**

Pick a project folder in the app. Then:
```bash
curl http://localhost:7878/status
```

Expected: `"cwd"` field shows the selected project path.

- [ ] **Step 4: Test a recording session via curl**

```bash
# Start session
curl -X POST http://localhost:7878/session/start -H "Content-Type: application/json" -d '{}'
# Expected: {"sessionId":"chrome-2026-...","startTime":...,"stem":"2026-..."}

# Send a test event
curl -X POST http://localhost:7878/events -H "Content-Type: application/json" \
  -d '{"events":[{"type":"click","ts_ms":500,"x":100,"y":200,"url":"https://example.com","page_title":"Test","element":{"tag":"button","id":"test-btn","text":"Click me","aria_label":null,"role":"button","placeholder":null,"data_testid":null,"selector":"#test-btn","xpath":"//button","classes":[],"bbox":{"x":90,"y":190,"width":80,"height":36}},"input_value":null,"key_combo":null,"scroll_dir":null,"nav_from":null,"nav_to":null}]}'
# Expected: {"ok":true}

# Stop session
curl -X POST http://localhost:7878/session/stop -H "Content-Type: application/json" -d '{}'
```

Verify the `.db` file was created in `<project>/recordings/` and contains the chrome_events row.

- [ ] **Step 5: Test full extension recording**

1. Reload extension in `chrome://extensions`
2. Navigate to any web app in Chrome
3. Click extension icon → popup shows "Connected to e2e-code"
4. Click "Start Recording" → popup shows `● 00:01` timer
5. Click around the web page for 10 seconds
6. Click "Stop Recording" → popup shows "Saving…" then "Saved — check e2e-code app"
7. RecordingsList in Electron refreshes and shows the new recording
8. Click the recording → RecordingPlayer shows events with rich labels (element text + selector instead of coordinates)

- [ ] **Step 6: Test analysis with enriched data**

1. Open the chrome recording in RecordingPlayer
2. Click "Analyze with Claude"
3. Open the generated `analyze.md` — verify rows look like:
   ```
   | 1 | 00:02.3 | mousedown | "Sign In" button [#sign-in-btn] | frame-2300.jpg |
   ```
   instead of:
   ```
   | 1 | 00:02.3 | mousedown | left (452, 300) | frame-2300.jpg |
   ```
4. Let Claude analyze → verify `result.md` names specific elements, not "a button in the top area"

---

## Self-Review Notes

- **Spec coverage:** All 5 spec sections covered: extension (Tasks 1-5), chrome-bridge (Task 6), IPC (Tasks 7-8), player integration (Task 9), verification (Task 10).
- **No placeholders:** All code shown in full. No TBDs.
- **Type consistency:** `ChromeEvent` defined once in `preload.ts` (for renderer) and `types.ts` (for extension). The DB column names (`el_tag`, `el_id`, etc.) match across `chrome-bridge.ts` insertChrome statement and `preload.ts` `ChromeEvent` interface.
- **`setActiveCwd` call site:** Task 9 Step 4 notes to add `onFileListChanged` to the parent component, but does not show exactly which file. The parent that holds `refreshKey` for `RecordingsList` needs to be found and updated — this is the only open-ended step. Run `grep -r "refreshKey" apps/web/src` to locate it.
