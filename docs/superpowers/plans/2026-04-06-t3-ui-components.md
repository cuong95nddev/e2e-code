# Adopt t3code UI Component Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the full t3code UI component library (36+ components) to `apps/web`, with dark-only theming and all required dependencies.

**Architecture:** Copy all UI components from t3code verbatim, add supporting hooks and utilities, adapt `index.css` with dark-only design tokens, configure `~` path alias for imports.

**Tech Stack:** `@base-ui/react`, `class-variance-authority`, `tailwind-merge`, Tailwind CSS v4, React 19

---

### Task 1: Install Dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add new dependencies**

```bash
cd apps/web && bun add @base-ui/react class-variance-authority tailwind-merge
```

- [ ] **Step 2: Verify installation**

```bash
bun install
```

Expected: No errors, lock file updated.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json bun.lock
git commit -m "feat(web): add base-ui, cva, tailwind-merge dependencies"
```

---

### Task 2: Configure `~` Path Alias

**Files:**
- Modify: `apps/web/tsconfig.json`
- Modify: `apps/web/vite.config.ts`

- [ ] **Step 1: Add paths to tsconfig.json**

Replace the contents of `apps/web/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "paths": {
      "~/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Add resolve alias to vite.config.ts**

Replace the contents of `apps/web/vite.config.ts` with:

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";

const port = Number(process.env.PORT ?? 5733);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
```

- [ ] **Step 3: Verify typecheck still works**

```bash
cd apps/web && bunx tsc --noEmit
```

Expected: No new errors from alias config (components not yet added).

- [ ] **Step 4: Commit**

```bash
git add apps/web/tsconfig.json apps/web/vite.config.ts
git commit -m "feat(web): configure ~ path alias for src imports"
```

---

### Task 3: Add `cn()` Utility

**Files:**
- Create: `apps/web/src/lib/utils.ts`

- [ ] **Step 1: Create the utility file**

```ts
import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/utils.ts
git commit -m "feat(web): add cn() utility (twMerge + cx)"
```

---

### Task 4: Add Supporting Hooks

**Files:**
- Create: `apps/web/src/hooks/useMediaQuery.ts`
- Create: `apps/web/src/hooks/useCopyToClipboard.ts`

These hooks are required by `sidebar.tsx` and `toast.tsx`.

- [ ] **Step 1: Create useMediaQuery hook**

Copy `/tmp/t3code/apps/web/src/hooks/useMediaQuery.ts` verbatim to `apps/web/src/hooks/useMediaQuery.ts`. This file has no external dependencies — it's pure React.

- [ ] **Step 2: Create useCopyToClipboard hook**

Copy `/tmp/t3code/apps/web/src/hooks/useCopyToClipboard.ts` verbatim to `apps/web/src/hooks/useCopyToClipboard.ts`. This file has no external dependencies — it's pure React.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/
git commit -m "feat(web): add useMediaQuery and useCopyToClipboard hooks"
```

---

### Task 5: Copy All UI Components

**Files:**
- Create: `apps/web/src/components/ui/` (36+ files)

- [ ] **Step 1: Copy all UI component files from t3code**

```bash
mkdir -p apps/web/src/components/ui
cp /tmp/t3code/apps/web/src/components/ui/*.tsx apps/web/src/components/ui/
cp /tmp/t3code/apps/web/src/components/ui/*.ts apps/web/src/components/ui/
```

Do NOT copy test files (`sidebar.test.tsx`, `toast.logic.test.ts`).

- [ ] **Step 2: Remove test files if copied**

```bash
rm -f apps/web/src/components/ui/sidebar.test.tsx
rm -f apps/web/src/components/ui/toast.logic.test.ts
```

- [ ] **Step 3: Commit raw copy**

```bash
git add apps/web/src/components/ui/
git commit -m "feat(web): copy all t3code UI components (raw)"
```

---

### Task 6: Adapt Components — Remove t3-Specific Dependencies

**Files:**
- Modify: `apps/web/src/components/ui/toast.tsx`
- Modify: `apps/web/src/components/ui/sidebar.tsx`

- [ ] **Step 1: Adapt toast.tsx**

`toast.tsx` imports from `@t3tools/contracts` (ThreadId), `@tanstack/react-router` (useParams), and `~/hooks/useCopyToClipboard`. We need to:

1. Remove the `ThreadId` import and `@t3tools/contracts` dependency
2. Remove the `@tanstack/react-router` import
3. Replace `ThreadId` type with `string`
4. Replace `useActiveThreadIdFromRoute` with a stub that returns `null`
5. Keep `useCopyToClipboard` import as-is (we created the hook in Task 4)

In `toast.tsx`, make these changes:

Remove these imports:
```ts
import { useParams } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
```

Change the `ThreadToastData` type:
```ts
export type ThreadToastData = {
  threadId?: string | null;
  tooltipStyle?: boolean;
  dismissAfterVisibleMs?: number;
  hideCopyButton?: boolean;
};
```

Replace `shouldRenderForActiveThread`:
```ts
function shouldRenderForActiveThread(
  data: ThreadToastData | undefined,
  activeThreadId: string | null,
): boolean {
  const toastThreadId = data?.threadId;
  if (!toastThreadId) return true;
  return toastThreadId === activeThreadId;
}
```

Replace `useActiveThreadIdFromRoute`:
```ts
function useActiveThreadIdFromRoute(): string | null {
  return null;
}
```

- [ ] **Step 2: Adapt sidebar.tsx**

`sidebar.tsx` imports `useIsMobile` from `~/hooks/useMediaQuery` and `getLocalStorageItem`/`setLocalStorageItem` from `~/hooks/useLocalStorage`.

For the localStorage functions, create a simplified version inline. Read `sidebar.tsx` first to understand the exact usage, then:

1. Keep the `useIsMobile` import as-is (we created the hook in Task 4)
2. Replace the `~/hooks/useLocalStorage` import with simple `localStorage` wrappers:

Replace:
```ts
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
```

With:
```ts
const getLocalStorageItem = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const setLocalStorageItem = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* noop */ }
};
```

Then find any calls to these functions that pass a Schema argument and simplify them to work with plain strings. The sidebar likely uses them for storing sidebar open/closed state as a simple boolean string.

- [ ] **Step 3: Verify no remaining t3-specific imports**

```bash
cd apps/web && grep -r "@t3tools\|@tanstack/react-router\|~/hooks/useLocalStorage" src/components/ui/ || echo "Clean!"
```

Expected: "Clean!"

- [ ] **Step 4: Commit adaptations**

```bash
git add apps/web/src/components/ui/toast.tsx apps/web/src/components/ui/sidebar.tsx
git commit -m "feat(web): adapt toast and sidebar to remove t3-specific deps"
```

---

### Task 7: Update index.css with Design Tokens

**Files:**
- Modify: `apps/web/src/index.css`

- [ ] **Step 1: Replace index.css with merged design tokens**

The new `index.css` must:
1. Import tailwindcss and xterm CSS
2. Define `@custom-variant dark` for the dark class
3. Define `@theme inline` with all t3 color/radius mappings
4. Set `:root` with dark-only token values (taken from t3's `@variant dark` block)
5. Add `.dark` class permanently on `:root` via the base layer
6. Keep existing body, html, #root sizing
7. Keep xterm CSS import
8. Keep existing font preferences (SF Mono for code)
9. Add t3's body font (DM Sans) for non-code text
10. Keep scrollbar styles (use t3's dark scrollbar styles)
11. Add t3's noise overlay on body::after
12. Keep drag-region styles for Electron

Write this content to `apps/web/src/index.css`:

```css
@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css";

@custom-variant dark (&:is(.dark, .dark *));

@theme inline {
  --animate-skeleton: skeleton 2s -1s infinite linear;
  --color-warning-foreground: var(--warning-foreground);
  --color-warning: var(--warning);
  --color-success-foreground: var(--success-foreground);
  --color-success: var(--success);
  --color-info-foreground: var(--info-foreground);
  --color-info: var(--info);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --color-foreground: var(--foreground);
  --color-background: var(--background);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --radius-2xl: calc(var(--radius) + 8px);
  --radius-3xl: calc(var(--radius) + 12px);
  --radius-4xl: calc(var(--radius) + 16px);
  @keyframes skeleton {
    to {
      background-position: -200% 0;
    }
  }
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground relative;
  }
}

/* Dark-only: set dark mode tokens directly on :root */
:root {
  color-scheme: dark;
  --radius: 0.625rem;
  --background: color-mix(in srgb, var(--color-neutral-950) 95%, var(--color-white));
  --foreground: var(--color-neutral-100);
  --card: color-mix(in srgb, var(--background) 98%, var(--color-white));
  --card-foreground: var(--color-neutral-100);
  --popover: color-mix(in srgb, var(--background) 98%, var(--color-white));
  --popover-foreground: var(--color-neutral-100);
  --primary: oklch(0.588 0.217 264);
  --primary-foreground: var(--color-white);
  --secondary: --alpha(var(--color-white) / 4%);
  --secondary-foreground: var(--color-neutral-100);
  --muted: --alpha(var(--color-white) / 4%);
  --muted-foreground: color-mix(in srgb, var(--color-neutral-500) 90%, var(--color-white));
  --accent: --alpha(var(--color-white) / 4%);
  --accent-foreground: var(--color-neutral-100);
  --destructive: color-mix(in srgb, var(--color-red-500) 90%, var(--color-white));
  --border: --alpha(var(--color-white) / 6%);
  --input: --alpha(var(--color-white) / 8%);
  --ring: oklch(0.588 0.217 264);
  --destructive-foreground: var(--color-red-400);
  --info: var(--color-blue-500);
  --info-foreground: var(--color-blue-400);
  --success: var(--color-emerald-500);
  --success-foreground: var(--color-emerald-400);
  --warning: var(--color-amber-500);
  --warning-foreground: var(--color-amber-400);
}

html {
  /* Force dark class for all t3 components */
  &,
  & * {
    /* Dark-only mode — tokens are set directly on :root */
  }
}

html,
body,
#root {
  height: 100%;
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 0;
  overflow-y: hidden;
  overflow-x: hidden;
  overflow-x: clip;
  overscroll-behavior-y: none;
}

body {
  font-family:
    "DM Sans",
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    system-ui,
    sans-serif;
}

body::after {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 256px 256px;
}

pre,
code,
textarea,
input {
  font-family: "SF Mono", "SFMono-Regular", "Fira Code", "Cascadia Code", Consolas, "Liberation Mono", Menlo, monospace;
}

/* Window drag region (frameless titlebar) */
.drag-region {
  -webkit-app-region: drag;
}

.drag-region button,
.drag-region input,
.drag-region textarea,
.drag-region select,
.drag-region a {
  -webkit-app-region: no-drag;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}
```

- [ ] **Step 2: Add `dark` class to index.html**

In `apps/web/index.html`, add the `dark` class to the `<html>` tag:

```html
<html lang="en" class="dark">
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/index.css apps/web/index.html
git commit -m "feat(web): add t3 design tokens (dark-only) and update index.css"
```

---

### Task 8: Verify Everything Works

**Files:** None (verification only)

- [ ] **Step 1: Typecheck**

```bash
cd /Users/cuongpham/ws/automation && bun run typecheck
```

Expected: No errors. If there are errors, they will likely be in the copied components — fix import paths or type issues.

- [ ] **Step 2: Build**

```bash
bun run build
```

Expected: Build succeeds.

- [ ] **Step 3: Dev server smoke test**

```bash
bun run dev
```

Expected: App launches, existing UI works as before. Check browser console for errors.

- [ ] **Step 4: Fix any issues found**

If typecheck or build fails, the most likely issues are:
- Import path mismatches (should all use `~/` prefix)
- Missing type for `@base-ui/react` subpath imports
- The `sidebar.tsx` localStorage adaptation may need adjustment based on exact usage

Fix issues, then commit:

```bash
git add -A
git commit -m "fix(web): resolve type/build issues in copied UI components"
```

---

### Summary of Files

| Action | Path |
|--------|------|
| Modify | `apps/web/package.json` (new deps) |
| Modify | `apps/web/tsconfig.json` (paths alias) |
| Modify | `apps/web/vite.config.ts` (resolve alias) |
| Create | `apps/web/src/lib/utils.ts` |
| Create | `apps/web/src/hooks/useMediaQuery.ts` |
| Create | `apps/web/src/hooks/useCopyToClipboard.ts` |
| Create | `apps/web/src/components/ui/*.tsx` (36+ files) |
| Create | `apps/web/src/components/ui/toast.logic.ts` |
| Modify | `apps/web/src/components/ui/toast.tsx` (adapted) |
| Modify | `apps/web/src/components/ui/sidebar.tsx` (adapted) |
| Modify | `apps/web/src/index.css` (design tokens) |
| Modify | `apps/web/index.html` (dark class) |
