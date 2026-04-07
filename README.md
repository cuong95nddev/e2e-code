# e2e-code

A desktop app that helps you write and execute E2E tests more easily with AI agent support. Powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code) running in an embedded terminal.

## Architecture

```
apps/
  desktop/     Electron shell — spawns Claude Code CLI via node-pty, loads web UI
  web/         React frontend — xterm.js terminal, Tailwind CSS
packages/
  shared/      Logging utilities
```

**Data flow:**

```
Electron Main (node-pty) → IPC → Renderer (React + xterm.js) → User
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3.9 + Node 24 |
| Monorepo | Turborepo + Bun workspaces |
| Frontend | React 19, Vite 8, xterm.js, Tailwind CSS 4 |
| Desktop | Electron 40 |
| Terminal | node-pty + xterm.js |

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.9
- [Node.js](https://nodejs.org) >= 24.13.1
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude auth login`)

## Getting Started

```bash
# Install dependencies
bun install

# Start the desktop app
bun run dev
```

## Scripts

```bash
bun run dev          # Start desktop app in dev mode
bun run build        # Build all packages
bun run typecheck    # Type-check all packages
```

## License

MIT
