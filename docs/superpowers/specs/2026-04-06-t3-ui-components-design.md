# Adopt t3code UI Component Library

## Summary

Clone the full UI component library from [pingdotgg/t3code](https://github.com/pingdotgg/t3code) into the `apps/web` package. This adds 36+ production-grade, styled components built on `@base-ui/react`, `class-variance-authority`, and `tailwind-merge`. Dark-only mode — strip light mode tokens.

## New Dependencies

Add to `apps/web/package.json`:

- `@base-ui/react` — unstyled UI primitives (successor to Radix, maintained by MUI team)
- `class-variance-authority` — variant definitions for component styling
- `tailwind-merge` — intelligent Tailwind class merging

Existing deps stay: `lucide-react`, `@xterm/xterm`, `zustand`, `tailwindcss` v4.

## File Structure

```
apps/web/src/
├── lib/
│   └── utils.ts              ← NEW: cn() = twMerge(cx(...inputs))
├── components/
│   ├── ui/                   ← NEW: all 36+ t3 components
│   │   ├── alert-dialog.tsx
│   │   ├── alert.tsx
│   │   ├── autocomplete.tsx
│   │   ├── badge.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── checkbox.tsx
│   │   ├── collapsible.tsx
│   │   ├── combobox.tsx
│   │   ├── command.tsx
│   │   ├── dialog.tsx
│   │   ├── empty.tsx
│   │   ├── field.tsx
│   │   ├── fieldset.tsx
│   │   ├── form.tsx
│   │   ├── group.tsx
│   │   ├── input-group.tsx
│   │   ├── input.tsx
│   │   ├── kbd.tsx
│   │   ├── label.tsx
│   │   ├── menu.tsx
│   │   ├── popover.tsx
│   │   ├── radio-group.tsx
│   │   ├── scroll-area.tsx
│   │   ├── select.tsx
│   │   ├── separator.tsx
│   │   ├── sheet.tsx
│   │   ├── sidebar.tsx
│   │   ├── skeleton.tsx
│   │   ├── spinner.tsx
│   │   ├── switch.tsx
│   │   ├── textarea.tsx
│   │   ├── toast.tsx
│   │   ├── toast.logic.ts
│   │   ├── toggle-group.tsx
│   │   ├── toggle.tsx
│   │   └── tooltip.tsx
│   ├── App.tsx               (existing, unchanged)
│   ├── InputBar.tsx          (existing, unchanged)
│   ├── Sidebar.tsx           (existing, unchanged)
│   └── ...
├── index.css                 ← UPDATE: merge t3 design tokens
```

## Design Token Strategy

### Dark-only mode

- Copy t3's full CSS variable system
- Set `.dark` class on `<html>` permanently
- Keep only dark-mode token values
- Token categories: background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, info, success, warning
- Radius tokens: base `--radius` with computed sm/md/lg/xl/2xl/3xl/4xl
- Font: keep existing monospace stack for terminal; adopt "DM Sans" or keep system for UI text

### Merge with existing styles

- Preserve xterm terminal styles
- Preserve custom scrollbar styles
- Preserve `.drag-region` for Electron frameless window
- Replace hardcoded hex colors with CSS variable references where possible

## Import Path Setup

t3 uses `~/lib/utils` alias. Options:

1. Add `~` path alias in `vite.config.ts` pointing to `src/` (matches t3 convention)
2. Or use relative imports in copied components

Option 1 preferred — less diff when pulling future updates from t3.

## What Gets Copied Verbatim

1. All files from `t3code/apps/web/src/components/ui/`
2. `lib/utils.ts` with `cn()` function

## What Gets Adapted

1. `index.css` — merge t3 design tokens into existing file (keep xterm, scrollbar, drag-region styles)
2. Import paths if alias differs
3. Strip light-mode token values (dark-only)

## What Does NOT Change

- Existing components (InputBar, Sidebar, Terminal, ToolApproval, PlanReview, ModelSelector, PermissionToggle, App) remain unchanged
- No behavioral changes to the app
- Existing styling on current components untouched

## Verification

- `bun install` succeeds
- `bun run typecheck` passes
- `bun run dev` launches without errors
- Components can be imported and rendered (manual check)
- Existing app looks and works the same as before
