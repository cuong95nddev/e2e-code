# Recording Analysis — Design Spec
Date: 2026-04-07

## Goal
Add an "Analyze" button to RecordingPlayer that:
1. Extracts video frames at key action timestamps
2. Generates a structured prompt file pointing Claude Code to those frames
3. Injects the prompt into the active terminal session (Claude Code CLI)
4. A project-local skill teaches Claude Code how to produce a human-readable step-by-step breakdown

Output: numbered steps like "Step 1: Clicked the blue Submit button in the top-right corner"

---

## Architecture

### Frame Extraction (Renderer)

When user clicks "Analyze" in RecordingPlayer:

1. Filter events to "key events" — mousedown + first keydown of each typing burst (gap > 500ms)
2. For each key event, seek `<video>` to `ts_ms / 1000`, draw to `<canvas>`, export as JPEG (quality 0.85)
3. Send frame buffer + path via IPC `recorder:saveFrame(framePath, buffer)`
4. Frames saved to: `<cwd>/recordings/<stem>/frames/frame-<ts_ms>.jpg`

### Prompt File (Renderer)

After all frames saved, write `<cwd>/recordings/<stem>/analyze.md`:

```markdown
# Recording Analysis Task

## Your job
Invoke the /analyze-recording skill to analyze this recording.

## Frames directory
recordings/<stem>/frames/

## Action Events
| # | Time     | Type  | Detail                          | Frame                              |
|---|----------|-------|---------------------------------|------------------------------------|
| 1 | 00:01.2  | click | left (452, 300)                 | recordings/<stem>/frames/1200.jpg  |
| 2 | 00:03.5  | type  | "hello world"                   | recordings/<stem>/frames/3500.jpg  |
```

File written via IPC `recorder:writeFile(filePath, content)`.

### Claude Code Skill

`.claude/skills/analyze-recording.md` in project root:

- Instructs Claude to read each frame image alongside the event table
- Group consecutive keydowns into single "Type X" steps
- Output format: numbered list, each step = "[verb] [UI element/area] [context]"
- After the breakdown, offer to generate a Playwright test script

### Terminal Injection (Renderer)

```ts
window.electronAPI.pty.write(
  activeSessionId,
  `claude /analyze-recording recordings/${stem}/analyze.md\n`
);
```

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/components/RecordingPlayer.tsx` | Add "Analyze" button; canvas frame extraction logic; call new IPC |
| `apps/desktop/src/recorder-manager.ts` | Add IPC handlers: `recorder:saveFrame`, `recorder:writeFile` |
| `apps/desktop/src/preload.ts` | Expose `recorder.saveFrame`, `recorder.writeFile` on ElectronAPI |
| `.claude/skills/analyze-recording.md` | New skill file |

---

## Data Flow

```
User clicks "Analyze"
  → Renderer filters key events
  → For each: seek video → canvas → jpeg buffer → IPC saveFrame
  → Build markdown table of events + frame paths
  → IPC writeFile → analyze.md saved
  → pty.write → Claude Code CLI receives prompt
  → Claude reads analyze.md → reads frame images → produces step breakdown
```

---

## Constraints / Notes

- Frame extraction is synchronous-ish: each frame requires seeking the video and waiting for `seeked` event before drawing canvas. Must be sequential.
- `<canvas>` size matches video natural dimensions (naturalWidth x naturalHeight)
- No new npm packages required
- `recorder:saveFrame` receives `ArrayBuffer` (same pattern as existing `recorder:saveFile`)
- Skill file triggers via `/analyze-recording` slash command in Claude Code
