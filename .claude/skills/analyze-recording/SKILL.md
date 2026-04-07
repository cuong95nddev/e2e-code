---
name: analyze-recording
description: Use when given an analyze.md recording file containing action events and frame references to interpret as human-readable steps.
---

You have been given a recording analysis file. Follow these steps exactly:

## Step 1: Read the analysis file

Read the file passed as the argument to this skill invocation. It contains:
- A **Frames** table — one row per unique screen state with the image path and timestamp
- An **Action Events** table — all raw DB columns for each event, with a Frame column referencing the corresponding frame

## Step 2: Read each frame

Read every image listed in the **Frames** table (first column).
Build a visual understanding of each screen state before reading the action events.

## Step 3: Produce the breakdown

Output a numbered list of human-readable steps using these rules:

**Frame-to-step mapping:**
- Events that share the same frame path → one step
- Events with different frame paths → separate steps, even if the same action type
- A single logical action (e.g. a drag) may span multiple frames → list all frames for that step
- Every unique frame in the event table must appear in exactly one step — none left unmapped

**Writing each step:**
- Start with a verb: "Clicked", "Typed", "Scrolled", "Pressed"
- **Always use what's visible in the frame** to identify what was acted on — never rely solely on the event detail or test ID. If the event detail is generic, read the frame to find the surrounding context (adjacent label, row content, section heading) and use that instead.
- Group sequential keydown events within 2 seconds **that share the same frame** into a single "Typed X" step (concatenate all `key_char` values)
- Keyboard shortcuts (Cmd+, Ctrl+, Alt+ combos): use "Pressed Cmd+S" format
- Scrolls: describe direction and the content area
- One sentence per step — be specific even if the sentence is slightly longer

## Output format

Each step is prefixed with its frame filename(s):

```
## Step-by-Step Breakdown

1. `frame-2529.jpg` — Clicked [element] — [what it triggered, omit if obvious]
2. `frame-5007.jpg`, `frame-5207.jpg` — Scrolled down in [area]
3. `frame-6212.jpg` — Clicked [element]
...
```

After the breakdown, add a blank line and ask:
> "Would you like me to generate a Playwright test script from these steps?"

## Step 4: Save the result

Derive the output path from the input file path by replacing `analyze.md` with `result.md`.

Use the Write tool to save the complete Step-by-Step Breakdown to that path. Write only the breakdown section — starting from `## Step-by-Step Breakdown` — not the question at the end.
