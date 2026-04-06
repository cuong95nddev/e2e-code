# Claude Desktop - Design Spec

## Overview

A macOS desktop application (Electron) that provides a terminal-style UI for interacting with Claude Code. Built with the same architecture as t3code: monorepo (Turborepo + Bun), Effect-TS backend, React frontend, Claude Agent SDK integration.

## Architecture

### Monorepo Structure

```
claude-desktop/
├── apps/
│   ├── desktop/          → Electron shell (tsdown build)
│   ├── server/           → Node.js backend (Effect-TS + Claude Agent SDK)
│   └── web/              → React + Vite 8 + TanStack Router
├── packages/
│   ├── contracts/        → Shared RPC schemas, types (Effect Schema + Rpc)
│   └── shared/           → Model utils, shell helpers, logging
├── turbo.json
├── package.json          → Bun workspace root
└── tsconfig.base.json
```

### Data Flow

```
User input (React)
  → Effect RPC over WebSocket (WsRpcGroup from contracts)
  → Server (Effect-TS Layers)
  → Claude Agent SDK query() → spawns Claude Code CLI binary
  → AsyncIterable<SDKMessage> stream back
  → Server transform → WS RPC events → React render (xterm.js)
```

### Desktop ↔ Server ↔ Web Communication

1. **Desktop** starts → spawns **Server** as child process (`ELECTRON_RUN_AS_NODE=1`), passes config via fd 3 pipe (port, authToken, paths)
2. **Web** discovers server via `window.desktopBridge.getWsUrl()` (Electron preload IPC)
3. **Dev mode**: Web loads from Vite dev server URL
4. **Prod mode**: Web loads via custom Electron protocol (local files, no HTTP)

### WebSocket RPC

- Uses `effect/unstable/rpc` (RpcServer + RpcClient), NOT ws/socket.io
- `WsRpcGroup` defined in contracts package with typed schemas
- JSON serialization via `RpcSerialization.layerJson`
- WS endpoint at `GET /ws?token={authToken}`

## Core Features

### 1. Session Management

- Create/stop/resume sessions with Claude Code
- Each session = 1 SDK `query()` instance
- Multi-turn via prompt queue (`AsyncIterable<SDKUserMessage>`)
- Session ID stored for resume capability
- `pathToClaudeCodeExecutable` configurable (default: `claude` from PATH)

### 2. Terminal UI (xterm.js)

- Real-time streaming output (text, reasoning tokens, tool output)
- Dark theme, monospace font
- Separate input area at bottom
- Markdown rendering for assistant responses
- Syntax highlighting for code blocks

### 3. Tool Approval

- SDK's `canUseTool` callback → server forwards to web via RPC
- UI displays tool name + arguments for review
- User can approve or deny each tool call
- "Full-access" mode: auto-approve all tool calls
- Permission mode switching mid-session

### 4. Plan Mode

- Intercept `ExitPlanMode` tool call from SDK
- Extract plan markdown content
- Display plan for user review before execution
- User can approve plan or request changes

### 5. Model Switching

- Change model mid-session via `context.query.setModel()`
- UI dropdown: Opus, Sonnet, Haiku
- Detect subscription type from `claude auth status` to show available models

### 6. File Explorer

- Tree view sidebar showing workspace files
- Click to view file content
- Collapsible sidebar

## Tech Stack

| Package | Version | Purpose |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | ^0.2.77 | Claude Code integration |
| `effect` | 4.x beta | Core framework (Layers, Streams, RPC) |
| `electron` | latest | Desktop shell |
| `@xterm/xterm` | latest | Terminal rendering |
| `react` | 19 | UI framework |
| `vite` | 8 | Frontend build |
| `@tanstack/router` | latest | Routing |
| `zustand` | latest | Local state management |
| `tailwindcss` | 4 | Styling |
| `tsdown` | latest | Build (desktop, contracts) |
| `turborepo` | latest | Monorepo orchestration |
| `bun` | >= 1.3.9 | Package manager + runtime |

## Authentication

- Relies entirely on Claude Code's own authentication
- Runs `claude auth status` to check login state
- If unauthenticated, prompts user to run `claude auth login`
- Detects subscription type (Free/Pro/Max/Enterprise) for UI adjustments

## Platform

- macOS only (initial release)
- Electron packaging via electron-builder or electron-forge

## Non-Goals (for now)

- Multi-provider support (Codex, etc.)
- Windows/Linux support
- Cloud/web-only deployment
- Collaborative/multi-user features
