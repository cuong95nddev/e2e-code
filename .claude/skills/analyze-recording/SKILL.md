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
- **Always include specific identifiers visible in the frame**: patient IDs, patient names, row text, form titles, table cell values, modal titles, URLs, record numbers — whatever text uniquely identifies what was acted on. Never write "a patient row" when you can read "Patient ID: 05-001" from the frame; write "the row for Patient 05-001" instead.
- **For tables and lists**: read the actual row content (ID, name, status, date) from the frame and include it. Example: "Clicked the 'TEST - LANTERN Study' row" not "Clicked a row in the study list".
- **For form fields and modals**: include the form name, field label, and any visible value. Example: "Clicked 'Reproductive System Findings Form' in the left nav panel" not "Clicked a form item".
- Identify the UI element being interacted with from the frame (button label, input field name, menu item, etc.)
- Group sequential keydown events where each event is within 2 seconds of the previous one into a single "Typed X" step. The typed text is the concatenation of all key_char values in the group.
- For keyboard shortcuts (Cmd+, Ctrl+, Alt+ combinations), use the format "Pressed Cmd+S" instead of "Typed"
- For mouse clicks, describe the element and its location (e.g. "the Save button in the top toolbar")
- For scrolls, describe the direction and the content area being scrolled
- Keep each step to one sentence but do NOT sacrifice specificity for brevity — include the identifier even if the sentence is slightly longer

## Output format

```
## Step-by-Step Breakdown

1. Clicked [element] — [what it triggered or why, omit if obvious]
2. Typed "[text]" — [brief context]
3. Scrolled down in [area]
...
```

After the breakdown, add a blank line and ask:
> "Would you like me to generate a Playwright test script from these steps?"

## Step 4: Save the result

Derive the output path from the input file path by replacing `analyze.md` with `result.md`.

Use the Write tool to write the complete Step-by-Step Breakdown to that path. Write only the breakdown section — starting from `## Step-by-Step Breakdown` — not the question at the end.
