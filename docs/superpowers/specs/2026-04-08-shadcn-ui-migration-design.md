# shadcn/ui Migration Design

**Date:** 2026-04-08  
**Scope:** Full component rewrite — replace all custom-styled UI with shadcn/ui primitives  
**App:** `apps/web` (React 19 + Vite 8 + Tailwind CSS v4)

---

## Goal

Adopt shadcn/ui as the system UI library across the entire `apps/web` frontend. Every component gets rewritten to use shadcn primitives. The xterm.js terminal and video player logic are preserved but wrapped in shadcn layout components. README and CLAUDE.md are updated to reflect the new stack.

---

## Stack

| Layer | Current | After |
|---|---|---|
| Styling | Tailwind CSS v4 (custom GitHub Dark) | Tailwind CSS v4 + shadcn/ui zinc dark |
| Components | Hand-rolled with Tailwind utility classes | shadcn/ui primitives |
| Theme | Manual #0d1117 / #e6edf3 colors | shadcn CSS variables (zinc dark) |

No Tailwind version change — shadcn/ui officially supports Tailwind v4 as of its latest release.

---

## Setup Steps

1. Run `npx shadcn@latest init` in `apps/web` with Tailwind v4 configuration
2. Replace `index.css` with shadcn's zinc dark CSS variable definitions + xterm-specific overrides
3. Install shadcn components: `button`, `card`, `scroll-area`, `separator`, `badge`, `tabs`, `tooltip`, `progress`, `input`, `label`, `sheet`, `dropdown-menu`, `dialog`

---

## Component Rewrites

### `App.tsx`
- Use `Separator` in place of drag-handle dividers
- Wrap panels in clean layout divs using shadcn `bg-background`, `border-border` tokens
- Use `Sheet` for any overlay/sidebar behavior if added later
- Keep all resize drag logic and session state as-is

### `RecordButton.tsx`
- Replace custom button divs with shadcn `Button` (variants: default, destructive, outline)
- Use `DropdownMenu` for mode selection if applicable
- Use `Badge` for status indicators

### `RecordingsList.tsx`
- Wrap list in `ScrollArea` for overflow handling
- Each recording entry becomes a `Card` or list item with shadcn hover styles
- Use `Badge` for file size / duration metadata
- Use `Separator` between items

### `RecordingPlayer.tsx`
- Outer container: `Card` with `CardHeader` / `CardContent`
- Transport controls: shadcn `Button` components
- Progress/timeline: shadcn `Progress` or custom range input styled with CSS variables
- Metadata display: `Separator`, `Badge`, `Tooltip` for timestamps
- Keep all video element, WebM, and DB sync logic untouched

### `AnalysisPanel.tsx`
- Wrap in `Card` with `CardHeader` / `CardContent`
- Use `ScrollArea` for long analysis content
- Use `Badge` for step labels / status
- Use `Separator` between analysis sections

### `RecordingIndicator.tsx`
- Replace custom timer display with shadcn `Badge` (destructive variant for recording state)
- Stop button: shadcn `Button` (destructive)

### `Terminal.tsx`
- Wrap xterm.js mount div in a `Card` container
- Apply `bg-background`/`border` tokens to the card shell
- All xterm.js logic, PTY IPC, resize observer stays unchanged

---

## CSS / Theme

Replace the current `index.css` body defaults with shadcn's zinc dark variable set:

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 240 10% 3.9%;
    --foreground: 0 0% 98%;
    --card: 240 10% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 240 10% 3.9%;
    --popover-foreground: 0 0% 98%;
    --primary: 0 0% 98%;
    --primary-foreground: 240 5.9% 10%;
    --secondary: 240 3.7% 15.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 240 3.7% 15.9%;
    --muted-foreground: 240 5% 64.9%;
    --accent: 240 3.7% 15.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 240 3.7% 15.9%;
    --input: 240 3.7% 15.9%;
    --ring: 240 4.9% 83.9%;
    --radius: 0.5rem;
  }
}
```

Retain xterm-specific overrides (height: 100%, overflow rules).

---

## Documentation Updates

### `README.md`
- Update stack table: replace "Tailwind CSS" row with "shadcn/ui + Tailwind CSS v4"
- Add note about shadcn component library under the Architecture section

### `CLAUDE.md`
- Update the stack/architecture description to mention shadcn/ui
- Note where shadcn components live (`apps/web/src/components/ui/`)

---

## What Stays Unchanged

- xterm.js internals and PTY integration
- Electron IPC handlers and preload bridge
- Video recording and WebM processing logic
- `useRecorder` hook
- `packages/shared` utilities
- `apps/desktop` entirely

---

## Out of Scope

- Adding new features or changing layout structure beyond what shadcn enables
- Changing Tailwind version
- Any changes to `apps/desktop` or `packages/shared`
