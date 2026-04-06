# Claude Desktop

A macOS desktop application that provides a terminal-style UI for interacting with [Claude Code](https://docs.anthropic.com/en/docs/claude-code), built with the same architecture as [t3code](https://github.com/pingdotgg/t3code).

## Architecture

```
apps/
  desktop/     Electron shell — spawns server, loads web UI
  server/      Node.js backend — Claude Agent SDK, WebSocket RPC
  web/         React frontend — xterm.js terminal, Tailwind CSS
packages/
  contracts/   Shared RPC schemas and types (Effect Schema)
  shared/      Net service, model utilities, logging
```

**Data flow:**

```
User input (React) → WebSocket JSON-RPC → Server → Claude Agent SDK → Claude Code CLI
                   ← streaming events  ← Server ← AsyncIterable<SDKMessage>
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun 1.3.9 + Node 24 |
| Monorepo | Turborepo + Bun workspaces |
| Backend | Effect-TS 4.x, Claude Agent SDK |
| Frontend | React 19, Vite 8, xterm.js, Zustand, Tailwind CSS 4 |
| Desktop | Electron 40 |
| Build | tsdown |

## Prerequisites

- [Bun](https://bun.sh) >= 1.3.9
- [Node.js](https://nodejs.org) >= 24.13.1
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude auth login`)

## Getting Started

```bash
# Install dependencies
bun install

# Build contracts (required before dev)
cd packages/contracts && bun run build && cd ../..

# Start server (terminal 1)
cd apps/server && bun run dev

# Start web UI (terminal 2)
cd apps/web && VITE_WS_URL=ws://localhost:3100/ws bun run dev
```

Open http://localhost:5733 in your browser.

## Features

- **Terminal UI** — streaming Claude Code output rendered in xterm.js with ANSI color support
- **Tool Approval** — review and approve/deny tool calls from Claude Code
- **Plan Mode** — review execution plans before they run
- **Model Switching** — switch between Sonnet, Opus, and Haiku mid-session
- **Permission Modes** — Default, Plan, or Full Access
- **Session Management** — start, stop, and resume sessions
- **Desktop App** — Electron shell with native macOS integration

## Scripts

```bash
bun run dev            # Start all apps in dev mode
bun run dev:web        # Start web only
bun run dev:server     # Start server only
bun run dev:desktop    # Start Electron desktop app
bun run build          # Build all packages
bun run typecheck      # Type-check all packages
```

## How It Works

The application integrates with Claude Code through the official [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk). The SDK spawns the Claude Code CLI as a subprocess and communicates via an async iterable stream. This means:

- No direct API calls to Anthropic — all requests go through Claude Code
- Authentication is handled by Claude Code (`claude auth login`)
- All Claude Code features (tools, permissions, plans) are available

## License

MIT
