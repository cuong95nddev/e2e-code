# Recording Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Analyze" button to RecordingPlayer that extracts video frames at key action timestamps, writes a structured prompt file, and injects it into the Claude Code terminal so Claude produces a human-readable step-by-step breakdown.

**Architecture:** The Renderer extracts JPEG frames from the `<video>` element via `<canvas>` and writes them + a markdown prompt file to disk via two new IPC handlers. A project-local Claude Code skill file tells Claude how to read those frames and produce numbered steps. The terminal injection uses the existing `pty.write` IPC.

**Tech Stack:** Electron IPC, HTMLVideoElement/Canvas API, React, TypeScript, Claude Code skill files (markdown)

---

## File Map

| File | Role |
|------|------|
| `.claude/skills/analyze-recording.md` | New — Claude Code skill: instructs Claude to read frames + produce step breakdown |
| `apps/desktop/src/recorder-manager.ts` | Modify — add `recorder:saveFrame` and `recorder:writeFile` IPC handlers |
| `apps/desktop/src/preload.ts` | Modify — expose `saveFrame` and `writeFile` on `ElectronAPI.recorder` |
| `apps/web/src/components/RecordingPlayer.tsx` | Modify — add "Analyze" button, canvas frame extraction, prompt generation, terminal injection |
| `apps/web/src/App.tsx` | Modify — pass `cwd` and `activeSessionId` props to RecordingPlayer |

---

## Task 1: Claude Code Skill File

**Files:**
- Create: `.claude/skills/analyze-recording.md`

- [ ] **Step 1: Create the `.claude/skills/` directory and skill file**

```bash
mkdir -p .claude/skills
```

Create `.claude/skills/analyze-recording.md`:

```markdown
---
name: analyze-recording
description: Analyze a screen recording by reading captured action events and video frames, then producing a human-readable step-by-step breakdown.
---

You have been given a recording analysis file. Follow these steps exactly:

## Step 1: Read the analysis file

Read the file passed as the argument to this skill invocation. It contains:
- A path to a frames directory
- A table of action events with timestamps, types, and frame references

## Step 2: Read each frame

For each row in the event table that has a frame path, read the image file at that path.
Use the image to understand what was visible on screen at the moment of the action.

## Step 3: Produce the breakdown

Output a numbered list of human-readable steps. Rules:
- Each step starts with a verb: "Clicked", "Typed", "Scrolled", "Right-clicked"
- Identify the UI element being interacted with from the frame (button label, input field name, menu item, etc.)
- Group consecutive keydown events within 2 seconds of each other into a single "Typed X" step
- For mouse clicks, describe the element and its location (e.g. "the Save button in the top toolbar")
- For scrolls, describe the direction and the content area being scrolled
- Keep each step to one sentence

## Output format

```
## Step-by-Step Breakdown

1. Clicked [element] — [brief context]
2. Typed "[text]" — [brief context]
3. Scrolled down in [area]
...
```

After the breakdown, add a blank line and ask:
> "Would you like me to generate a Playwright test script from these steps?"
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/analyze-recording.md
git commit -m "feat: add analyze-recording Claude Code skill"
```

---

## Task 2: IPC Handlers — saveFrame and writeFile

**Files:**
- Modify: `apps/desktop/src/recorder-manager.ts` — append two handlers inside `registerRecorderHandlers`

- [ ] **Step 1: Add `recorder:saveFrame` handler**

Inside `registerRecorderHandlers`, after the `recorder:saveFile` handler, add:

```ts
// --- saveFrame ---
ipcMain.handle("recorder:saveFrame", async (_event, framePath: string, buffer: ArrayBuffer) => {
  if (!framePath || !Path.isAbsolute(framePath)) throw new Error(`Invalid framePath: ${framePath}`);
  await FS.promises.mkdir(Path.dirname(framePath), { recursive: true });
  await FS.promises.writeFile(framePath, Buffer.from(buffer));
});
```

- [ ] **Step 2: Add `recorder:writeFile` handler**

Immediately after the saveFrame handler:

```ts
// --- writeFile ---
ipcMain.handle("recorder:writeFile", async (_event, filePath: string, content: string) => {
  if (!filePath || !Path.isAbsolute(filePath)) throw new Error(`Invalid filePath: ${filePath}`);
  await FS.promises.mkdir(Path.dirname(filePath), { recursive: true });
  await FS.promises.writeFile(filePath, content, "utf8");
});
```

- [ ] **Step 3: Verify the app still compiles**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/recorder-manager.ts
git commit -m "feat: add recorder:saveFrame and recorder:writeFile IPC handlers"
```

---

## Task 3: Expose New IPCs in Preload

**Files:**
- Modify: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Add types to `ElectronAPI.recorder`**

In the `ElectronAPI` interface, add to the `recorder` block:

```ts
saveFrame(framePath: string, buffer: ArrayBuffer): Promise<void>;
writeFile(filePath: string, content: string): Promise<void>;
```

The full updated `recorder` block:

```ts
recorder: {
  getSources(): Promise<{ id: string; name: string; thumbnail: string }[]>;
  openOverlay(screenSourceId: string): Promise<{ x: number; y: number; width: number; height: number } | null>;
  saveFile(cwd: string, buffer: ArrayBuffer, stem?: string): Promise<string>;
  listFiles(cwd: string): Promise<RecordingMeta[]>;
  onTogglePicker(callback: () => void): () => void;
  showTray(): void;
  hideTray(): void;
  onStopFromTray(callback: () => void): () => void;
  sessionStart(cwd: string): Promise<{ dbPath: string | null; stem: string; startTime: number; captureActive: boolean }>;
  sessionStop(): Promise<void>;
  queryActions(dbPath: string, fromMs: number, toMs: number): Promise<ActionEvent[]>;
  saveFrame(framePath: string, buffer: ArrayBuffer): Promise<void>;
  writeFile(filePath: string, content: string): Promise<void>;
};
```

- [ ] **Step 2: Add implementations to the `api` object**

In the `recorder` block of the `api` object, add:

```ts
saveFrame: (framePath: string, buffer: ArrayBuffer) =>
  ipcRenderer.invoke("recorder:saveFrame", framePath, buffer),
writeFile: (filePath: string, content: string) =>
  ipcRenderer.invoke("recorder:writeFile", filePath, content),
```

- [ ] **Step 3: Verify**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/preload.ts
git commit -m "feat: expose saveFrame and writeFile on ElectronAPI.recorder"
```

---

## Task 4: RecordingPlayer — Analyze Button + Frame Extraction

**Files:**
- Modify: `apps/web/src/components/RecordingPlayer.tsx`
- Modify: `apps/web/src/App.tsx`

### 4a: Pass new props from App.tsx

- [ ] **Step 1: Update RecordingPlayer props in App.tsx**

In `App.tsx`, find where `RecordingPlayer` is rendered (~line 199) and add two props:

```tsx
<RecordingPlayer
  key={selectedRecording.path}
  videoPath={selectedRecording.path}
  dbPath={selectedRecording.dbPath}
  cwd={activeSession?.cwd ?? null}
  activeSessionId={activeSessionId}
/>
```

### 4b: Add props + Analyze logic to RecordingPlayer.tsx

- [ ] **Step 2: Update the Props interface**

At the top of `RecordingPlayer.tsx`, update the interface:

```ts
interface Props {
  videoPath: string;
  dbPath: string | undefined;
  cwd: string | null;
  activeSessionId: string | null;
}
```

Update the function signature:

```ts
export function RecordingPlayer({ videoPath, dbPath, cwd, activeSessionId }: Props) {
```

- [ ] **Step 3: Add `analyzing` state and `canvasRef`**

After the existing `const listRef = useRef<HTMLDivElement>(null);` line, add:

```ts
const canvasRef = useRef<HTMLCanvasElement>(null);
const [analyzing, setAnalyzing] = useState(false);
```

- [ ] **Step 4: Add helper to derive `stem` from `videoPath`**

After the `seekTo` callback, add:

```ts
const stem = videoPath.split("/").pop()?.replace(".webm", "") ?? "recording";
```

- [ ] **Step 5: Add `filterKeyEvents` helper function**

Before the `RecordingPlayer` function (after the `describeEvent` function), add:

```ts
function filterKeyEvents(events: ActionEvent[]): ActionEvent[] {
  const result: ActionEvent[] = [];
  let lastKeydownTs = -Infinity;
  for (const e of events) {
    if (e.type === "mousedown") {
      result.push(e);
    } else if (e.type === "keydown") {
      // Only include first keydown of each typing burst (gap > 500ms)
      if (e.ts_ms - lastKeydownTs > 500) {
        result.push(e);
      }
      lastKeydownTs = e.ts_ms;
    }
  }
  return result;
}
```

- [ ] **Step 6: Add `extractFrame` helper**

After `filterKeyEvents`, add:

```ts
async function extractFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  tsMs: number,
): Promise<ArrayBuffer> {
  await new Promise<void>((resolve) => {
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = tsMs / 1000;
  });
  const ctx = canvas.getContext("2d")!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  return new Promise<ArrayBuffer>((resolve) => {
    canvas.toBlob((blob) => {
      blob!.arrayBuffer().then(resolve);
    }, "image/jpeg", 0.85);
  });
}
```

- [ ] **Step 7: Add `handleAnalyze` callback**

After the `seekTo` callback and `stem` derivation, add:

```ts
const handleAnalyze = useCallback(async () => {
  if (!cwd || !activeSessionId || !videoRef.current || !canvasRef.current) return;
  setAnalyzing(true);
  try {
    const keyEvents = filterKeyEvents(events);
    const framesDir = `${cwd}/recordings/${stem}/frames`;

    // Extract and save each frame
    const rows: string[] = [];
    for (let i = 0; i < keyEvents.length; i++) {
      const ev = keyEvents[i]!;
      const framePath = `${framesDir}/frame-${ev.ts_ms}.jpg`;
      const buffer = await extractFrame(videoRef.current, canvasRef.current, ev.ts_ms);
      await window.electronAPI.recorder.saveFrame(framePath, buffer);

      const relFrame = `recordings/${stem}/frames/frame-${ev.ts_ms}.jpg`;
      const detail = describeEvent(ev);
      rows.push(`| ${i + 1} | ${formatMs(ev.ts_ms)} | ${ev.type} | ${detail} | ${relFrame} |`);
    }

    // Build and write the analyze.md prompt file
    const promptPath = `${cwd}/recordings/${stem}/analyze.md`;
    const content = [
      `# Recording Analysis Task`,
      ``,
      `## Your job`,
      `Invoke the /analyze-recording skill to analyze this recording.`,
      ``,
      `## Frames directory`,
      `recordings/${stem}/frames/`,
      ``,
      `## Action Events`,
      `| # | Time | Type | Detail | Frame |`,
      `|---|------|------|--------|-------|`,
      ...rows,
    ].join("\n");

    await window.electronAPI.recorder.writeFile(promptPath, content);

    // Inject into terminal
    const relPrompt = `recordings/${stem}/analyze.md`;
    window.electronAPI.pty.write(activeSessionId, `/analyze-recording ${relPrompt}\n`);
  } finally {
    setAnalyzing(false);
  }
}, [cwd, activeSessionId, events, stem]);
```

- [ ] **Step 8: Add the hidden canvas element to JSX**

Inside the returned JSX, after the closing `</div>` of the event list (last element), add:

```tsx
{/* Hidden canvas for frame extraction */}
<canvas ref={canvasRef} className="hidden" />
```

- [ ] **Step 9: Add the "Analyze" button to JSX**

In the video section, after the `<video>` element and before the closing `</div>` of the video container, add:

```tsx
{events.length > 0 && (
  <div className="flex justify-end px-3 py-1.5">
    <button
      onClick={handleAnalyze}
      disabled={analyzing || !cwd || !activeSessionId}
      className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-[#30363d] bg-[#21262d] text-[#e6edf3] text-xs hover:bg-[#30363d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {analyzing ? (
        <>
          <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
          Analyzing…
        </>
      ) : (
        <>
          <span className="text-[#3fb950]">✦</span>
          Analyze with Claude
        </>
      )}
    </button>
  </div>
)}
```

- [ ] **Step 10: Verify typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 11: Smoke test manually**

```
1. bun run dev
2. Open a project folder
3. Record a short interaction (a few clicks + typing)
4. Stop recording, select it from the list
5. Click "Analyze with Claude"
6. Verify: frames appear in recordings/<stem>/frames/
7. Verify: recordings/<stem>/analyze.md was created with correct content
8. Verify: Claude Code terminal receives the /analyze-recording command
```

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/RecordingPlayer.tsx apps/web/src/App.tsx
git commit -m "feat: add Analyze button to RecordingPlayer with canvas frame extraction"
```
