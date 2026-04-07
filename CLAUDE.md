# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**e2e-code** — A desktop app that helps write and execute E2E tests more easily with AI agent support. Powered by Claude Code CLI running in an embedded terminal.

## Commands

```bash
bun install
bun run dev                               # desktop app (default)
bun run build                             # build all
bun run typecheck                         # typecheck all
```

No tests yet.

## Architecture

Monorepo (Turborepo + Bun). Desktop-only Electron app that spawns the Claude Code CLI directly via `node-pty` and renders the interactive terminal with xterm.js in a React shell.

```
Electron Main (node-pty) → IPC → Renderer (React + xterm.js) → User
```

- `packages/shared` — Utilities (Net, models, logging). No build step.
- `apps/web` — React UI with xterm.js terminal (embedded in desktop app). Not run standalone.
- `apps/desktop` — Electron main process with PTY manager, IPC handlers, preload bridge.

## Native Modules

`node-pty` is rebuilt from source via `@electron/rebuild` on `postinstall` to ensure correct Electron ABI and executable permissions on `spawn-helper`.
