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
