# PTY Migration: Claude Agent SDK → Direct CLI via node-pty

## Summary

Migrate from the current architecture (Electron → React → WebSocket JSON-RPC → Effect-TS Server → Claude Agent SDK → Claude CLI) to Vibeyard's approach (Electron → xterm.js interactive terminal → IPC → Main Process node-pty → Claude CLI directly).

## What Gets Removed

- `apps/server` — entire package
- `packages/contracts` — entire package
- `@anthropic-ai/claude-agent-sdk` dependency
- All structured event types (SessionEvent, ToolApproval, PlanReview)
- React components: InputBar, ToolApproval, PlanReviewPanel, ModelSelector, PermissionToggle
- WebSocket transport (wsTransport.ts)
- Zustand session store
- Server process spawning from desktop main.ts

## What Gets Added

### PTY Manager (`apps/desktop/src/pty-manager.ts`)

Manages multiple PTY instances keyed by sessionId.

```typescript
spawnPty(sessionId, cwd, cliSessionId, isResume, onData, onExit): void
writePty(sessionId, data): void
resizePty(sessionId, cols, rows): void
killPty(sessionId): void
getFullPath(): string  // cached login shell PATH resolution
```

- Spawns `claude` CLI binary via `node-pty`
- Resolves full PATH from login shell (like Vibeyard)
- Sets env: full PATH, removes `CLAUDE_CODE`
- Args: `-r <id>` for resume, `--session-id <id>` for explicit session

### IPC Bridge

Preload exposes `window.electronAPI.pty`:

| Channel | Direction | Type |
|---------|-----------|------|
| `pty:create` | renderer → main | invoke |
| `pty:write` | renderer → main | send (fire-and-forget) |
| `pty:resize` | renderer → main | send |
| `pty:kill` | renderer → main | invoke |
| `pty:data` | main → renderer | webContents.send |
| `pty:exit` | main → renderer | webContents.send |
| `app:pickFolder` | renderer → main | invoke |
| `app:openExternal` | renderer → main | invoke |

### Renderer Changes

- Terminal becomes interactive (stdin enabled)
- `terminal.onData` → `pty.write` for keystroke forwarding
- `pty.onData` → `terminal.write` for output rendering
- Shift+Enter sends CSI u sequence for Claude CLI newline
- Tab bar for multi-session support
- Exit overlay with restart button on PTY exit

### Desktop Main Process

Simplified to:
```
app.whenReady() → registerIpcHandlers() → createWindow() → load renderer
```

No server spawning, no port finding, no auth tokens.

## What Stays

- `packages/shared` — logging, Net utilities, model metadata
- Electron window setup, protocol handler, logging
- React + Tailwind + xterm.js in renderer
- xterm addons (FitAddon, WebglAddon, SearchAddon, WebLinksAddon)

## Dependency Changes

**Add to desktop:** `node-pty`
**Remove packages:** `apps/server`, `packages/contracts`
**Update:** root package.json workspaces, turbo.json pipeline
