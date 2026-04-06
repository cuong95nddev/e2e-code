# Claude Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a macOS desktop app (Electron) with terminal-style UI for interacting with Claude Code, using the same architecture as t3code.

**Architecture:** Monorepo (Turborepo + Bun) with 3 apps (desktop, server, web) and 2 packages (contracts, shared). Server uses Effect-TS Layers + Claude Agent SDK, communicates with web via Effect RPC over WebSocket. Desktop is an Electron shell that spawns the server and loads the web UI.

**Tech Stack:** Bun 1.3.9, Effect 4.x, Electron 40, React 19, Vite 8, TanStack Router, xterm.js, Tailwind CSS 4, Claude Agent SDK, tsdown, Turborepo

---

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd /Users/cuongpham/ws/automation
git init
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "@claude-desktop/monorepo",
  "private": true,
  "workspaces": {
    "packages": [
      "apps/*",
      "packages/*"
    ],
    "catalog": {
      "effect": "4.0.0-beta.43",
      "@effect/platform-node": "4.0.0-beta.43",
      "@effect/vitest": "4.0.0-beta.43",
      "@types/node": "^24.10.13",
      "tsdown": "^0.20.3",
      "typescript": "^5.7.3",
      "vitest": "^4.0.0"
    }
  },
  "type": "module",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "turbo": "^2.3.3",
    "vitest": "catalog:"
  },
  "engines": {
    "bun": "^1.3.9",
    "node": "^24.13.1"
  },
  "packageManager": "bun@1.3.9"
}
```

- [ ] **Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": [
    "PORT",
    "VITE_WS_URL",
    "VITE_DEV_SERVER_URL",
    "ELECTRON_RENDERER_PORT",
    "CLAUDE_DESKTOP_PORT",
    "CLAUDE_DESKTOP_AUTH_TOKEN",
    "CLAUDE_DESKTOP_MODE"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "dist-electron/**"]
    },
    "dev": {
      "dependsOn": ["@claude-desktop/contracts#build"],
      "cache": false,
      "persistent": true
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": [],
      "cache": false
    }
  }
}
```

- [ ] **Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "useDefineForClassFields": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
dist-electron/
.turbo/
*.tsbuildinfo
.env
.DS_Store
```

- [ ] **Step 6: Create directory structure**

```bash
mkdir -p apps/desktop/src apps/server/src apps/web/src packages/contracts/src packages/shared/src
```

- [ ] **Step 7: Install dependencies and commit**

```bash
bun install
git add -A
git commit -m "chore: scaffold monorepo with turborepo + bun workspaces"
```

---

### Task 2: Contracts Package

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/ipc.ts`
- Create: `packages/contracts/src/provider.ts`
- Create: `packages/contracts/src/session.ts`
- Create: `packages/contracts/src/rpc.ts`

- [ ] **Step 1: Create packages/contracts/package.json**

```json
{
  "name": "@claude-desktop/contracts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.mjs",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "require": "./dist/index.cjs"
    }
  },
  "scripts": {
    "build": "tsdown src/index.ts --format esm,cjs --dts --clean",
    "dev": "tsdown src/index.ts --format esm,cjs --dts --watch --clean",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "tsdown": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create packages/contracts/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/contracts/src/ipc.ts — Electron IPC types**

```ts
import { Schema } from "effect";

export interface DesktopBridge {
  readonly getWsUrl: () => string | null;
  readonly pickFolder: () => Promise<string | null>;
  readonly openExternal: (url: string) => Promise<void>;
}

export const DesktopBridgeSchema = Schema.Struct({
  getWsUrl: Schema.Any,
  pickFolder: Schema.Any,
  openExternal: Schema.Any,
});
```

- [ ] **Step 4: Create packages/contracts/src/provider.ts — Provider types**

```ts
import { Schema } from "effect";

export const ProviderKind = Schema.Literal("claudeAgent");
export type ProviderKind = typeof ProviderKind.Type;

export const PermissionMode = Schema.Literal("default", "plan", "fullAccess");
export type PermissionMode = typeof PermissionMode.Type;

export const ModelId = Schema.Literal(
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
);
export type ModelId = typeof ModelId.Type;

export const AuthStatus = Schema.Struct({
  authenticated: Schema.Boolean,
  subscriptionType: Schema.optional(Schema.String),
  authMethod: Schema.optional(Schema.String),
});
export type AuthStatus = typeof AuthStatus.Type;
```

- [ ] **Step 5: Create packages/contracts/src/session.ts — Session types**

```ts
import { Schema } from "effect";
import { PermissionMode, ModelId } from "./provider";

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const SessionState = Schema.Literal(
  "idle",
  "running",
  "awaitingApproval",
  "awaitingPlanReview",
  "stopped",
);
export type SessionState = typeof SessionState.Type;

export const ToolApprovalRequest = Schema.Struct({
  toolName: Schema.String,
  toolInput: Schema.Unknown,
  requestId: Schema.String,
});
export type ToolApprovalRequest = typeof ToolApprovalRequest.Type;

export const ToolApprovalResponse = Schema.Struct({
  requestId: Schema.String,
  approved: Schema.Boolean,
});
export type ToolApprovalResponse = typeof ToolApprovalResponse.Type;

export const PlanReview = Schema.Struct({
  planMarkdown: Schema.String,
  requestId: Schema.String,
});
export type PlanReview = typeof PlanReview.Type;

export const PlanReviewResponse = Schema.Struct({
  requestId: Schema.String,
  approved: Schema.Boolean,
});
export type PlanReviewResponse = typeof PlanReviewResponse.Type;

export const SessionEvent = Schema.Union(
  Schema.Struct({ type: Schema.Literal("text"), content: Schema.String }),
  Schema.Struct({ type: Schema.Literal("reasoning"), content: Schema.String }),
  Schema.Struct({ type: Schema.Literal("toolUse"), toolName: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("toolResult"), toolName: Schema.String, output: Schema.String }),
  Schema.Struct({ type: Schema.Literal("approval"), request: ToolApprovalRequest }),
  Schema.Struct({ type: Schema.Literal("planReview"), review: PlanReview }),
  Schema.Struct({ type: Schema.Literal("turnComplete"), usage: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stateChange"), state: SessionState }),
);
export type SessionEvent = typeof SessionEvent.Type;

export const StartSessionInput = Schema.Struct({
  cwd: Schema.String,
  model: ModelId,
  permissionMode: PermissionMode,
  prompt: Schema.String,
  sessionId: Schema.optional(SessionId),
});
export type StartSessionInput = typeof StartSessionInput.Type;

export const SendTurnInput = Schema.Struct({
  sessionId: SessionId,
  prompt: Schema.String,
});
export type SendTurnInput = typeof SendTurnInput.Type;

export const StopSessionInput = Schema.Struct({
  sessionId: SessionId,
});
export type StopSessionInput = typeof StopSessionInput.Type;

export const SetModelInput = Schema.Struct({
  sessionId: SessionId,
  model: ModelId,
});
export type SetModelInput = typeof SetModelInput.Type;

export const SetPermissionModeInput = Schema.Struct({
  sessionId: SessionId,
  permissionMode: PermissionMode,
});
export type SetPermissionModeInput = typeof SetPermissionModeInput.Type;
```

- [ ] **Step 6: Create packages/contracts/src/rpc.ts — RPC group definition**

```ts
import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import {
  StartSessionInput,
  SendTurnInput,
  StopSessionInput,
  SetModelInput,
  SetPermissionModeInput,
  SessionEvent,
  SessionId,
  ToolApprovalResponse,
  PlanReviewResponse,
} from "./session";
import { AuthStatus } from "./provider";

export const SessionError = Schema.Struct({
  _tag: Schema.Literal("SessionError"),
  message: Schema.String,
});

export const WsRpcGroup = RpcGroup.make(
  Rpc.make("startSession", {
    payload: StartSessionInput,
    success: SessionId,
    error: SessionError,
  }),
  Rpc.make("sendTurn", {
    payload: SendTurnInput,
    success: Schema.Void,
    error: SessionError,
  }),
  Rpc.make("stopSession", {
    payload: StopSessionInput,
    success: Schema.Void,
    error: SessionError,
  }),
  Rpc.make("setModel", {
    payload: SetModelInput,
    success: Schema.Void,
    error: SessionError,
  }),
  Rpc.make("setPermissionMode", {
    payload: SetPermissionModeInput,
    success: Schema.Void,
    error: SessionError,
  }),
  Rpc.make("respondToolApproval", {
    payload: ToolApprovalResponse,
    success: Schema.Void,
    error: SessionError,
  }),
  Rpc.make("respondPlanReview", {
    payload: PlanReviewResponse,
    success: Schema.Void,
    error: SessionError,
  }),
  Rpc.make("getAuthStatus", {
    payload: Schema.Void,
    success: AuthStatus,
    error: SessionError,
  }),
  Rpc.stream("subscribeSessionEvents", {
    payload: Schema.Struct({ sessionId: SessionId }),
    success: SessionEvent,
    error: SessionError,
  }),
);
```

- [ ] **Step 7: Create packages/contracts/src/index.ts**

```ts
export * from "./ipc";
export * from "./provider";
export * from "./session";
export * from "./rpc";
```

- [ ] **Step 8: Build contracts and commit**

```bash
cd /Users/cuongpham/ws/automation
bun install
cd packages/contracts && bun run build
cd ../..
git add packages/contracts
git commit -m "feat: add contracts package with RPC schemas, session and provider types"
```

---

### Task 3: Shared Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/model.ts`
- Create: `packages/shared/src/Net.ts`
- Create: `packages/shared/src/logging.ts`

- [ ] **Step 1: Create packages/shared/package.json**

```json
{
  "name": "@claude-desktop/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    "./model": {
      "types": "./src/model.ts",
      "import": "./src/model.ts"
    },
    "./Net": {
      "types": "./src/Net.ts",
      "import": "./src/Net.ts"
    },
    "./logging": {
      "types": "./src/logging.ts",
      "import": "./src/logging.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@claude-desktop/contracts": "workspace:*",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create packages/shared/src/model.ts — Model utilities**

```ts
import type { ModelId } from "@claude-desktop/contracts";

export interface ModelInfo {
  readonly id: ModelId;
  readonly displayName: string;
  readonly contextWindow: number;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    contextWindow: 200_000,
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    displayName: "Claude Opus 4.6",
    contextWindow: 1_000_000,
  },
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    contextWindow: 200_000,
  },
};

export function getModelInfo(id: ModelId): ModelInfo {
  return MODELS[id];
}
```

- [ ] **Step 4: Create packages/shared/src/Net.ts — Port finding service**

```ts
import * as Net from "node:net";
import { Context, Effect, Layer } from "effect";

export class NetService extends Context.Tag("NetService")<
  NetService,
  {
    readonly findAvailablePort: (preferred?: number) => Effect.Effect<number>;
  }
>() {
  static readonly layer = Layer.succeed(NetService, {
    findAvailablePort: (preferred?: number) =>
      Effect.async<number>((resume) => {
        const server = Net.createServer();
        server.listen(preferred ?? 0, "127.0.0.1", () => {
          const addr = server.address();
          const port = typeof addr === "object" && addr !== null ? addr.port : 0;
          server.close(() => resume(Effect.succeed(port)));
        });
        server.on("error", () => {
          const fallback = Net.createServer();
          fallback.listen(0, "127.0.0.1", () => {
            const addr = fallback.address();
            const port = typeof addr === "object" && addr !== null ? addr.port : 0;
            fallback.close(() => resume(Effect.succeed(port)));
          });
        });
      }),
  });
}
```

- [ ] **Step 5: Create packages/shared/src/logging.ts — Rotating file logger**

```ts
import * as FS from "node:fs";
import * as Path from "node:path";

export class RotatingFileSink {
  private readonly dir: string;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private currentPath: string | null = null;
  private currentSize = 0;

  constructor(options: {
    dir: string;
    prefix: string;
    maxBytes?: number;
    maxFiles?: number;
  }) {
    this.dir = options.dir;
    this.prefix = options.prefix;
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 10;
    FS.mkdirSync(this.dir, { recursive: true });
    this.rotate();
  }

  write(data: string): void {
    if (this.currentPath === null) this.rotate();
    const bytes = Buffer.byteLength(data);
    if (this.currentSize + bytes > this.maxBytes) this.rotate();
    FS.appendFileSync(this.currentPath!, data);
    this.currentSize += bytes;
  }

  private rotate(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.currentPath = Path.join(this.dir, `${this.prefix}-${ts}.log`);
    this.currentSize = 0;
    this.cleanup();
  }

  private cleanup(): void {
    const files = FS.readdirSync(this.dir)
      .filter((f) => f.startsWith(this.prefix) && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const file of files.slice(this.maxFiles)) {
      FS.unlinkSync(Path.join(this.dir, file));
    }
  }
}
```

- [ ] **Step 6: Commit**

```bash
bun install
git add packages/shared
git commit -m "feat: add shared package with model utils, net service, and logging"
```

---

### Task 4: Server App — Core + Claude Adapter

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/bin.ts`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/server.ts`
- Create: `apps/server/src/ws.ts`
- Create: `apps/server/src/claude/ClaudeAdapter.ts`
- Create: `apps/server/src/claude/ClaudeProvider.ts`

- [ ] **Step 1: Create apps/server/package.json**

```json
{
  "name": "@claude-desktop/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --experimental-strip-types src/bin.ts",
    "build": "tsdown src/bin.ts --format esm --clean",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.77",
    "@effect/platform-node": "catalog:",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@claude-desktop/contracts": "workspace:*",
    "@claude-desktop/shared": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create apps/server/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create apps/server/src/config.ts — Server config via Effect Context**

```ts
import { Context, Effect, Layer, Schema } from "effect";

export class ServerConfig extends Context.Tag("ServerConfig")<
  ServerConfig,
  {
    readonly port: number;
    readonly authToken: string;
    readonly mode: "standalone" | "desktop";
  }
>() {}

export const ServerConfigFromEnv = Layer.effect(
  ServerConfig,
  Effect.sync(() => ({
    port: Number(process.env.CLAUDE_DESKTOP_PORT ?? "0"),
    authToken: process.env.CLAUDE_DESKTOP_AUTH_TOKEN ?? "",
    mode: (process.env.CLAUDE_DESKTOP_MODE ?? "standalone") as "standalone" | "desktop",
  })),
);
```

- [ ] **Step 4: Create apps/server/src/claude/ClaudeProvider.ts — Auth status check**

```ts
import * as ChildProcess from "node:child_process";
import { Effect } from "effect";
import type { AuthStatus } from "@claude-desktop/contracts";

export function checkAuthStatus(binaryPath = "claude"): Effect.Effect<AuthStatus> {
  return Effect.async<AuthStatus>((resume) => {
    const child = ChildProcess.spawn(binaryPath, ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      const authenticated = code === 0;
      const subscriptionType = extractField(stdout, /Account type:\s*(.+)/i);
      const authMethod = extractField(stdout, /Auth method:\s*(.+)/i);
      resume(
        Effect.succeed({
          authenticated,
          subscriptionType: subscriptionType ?? undefined,
          authMethod: authMethod ?? undefined,
        }),
      );
    });
    child.on("error", () => {
      resume(Effect.succeed({ authenticated: false }));
    });
  });
}

function extractField(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}
```

- [ ] **Step 5: Create apps/server/src/claude/ClaudeAdapter.ts — SDK integration**

```ts
import { Context, Effect, Layer, Queue, Stream } from "effect";
import {
  query,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SessionId,
  SessionEvent,
  PermissionMode,
  ModelId,
  ToolApprovalRequest,
  PlanReview,
} from "@claude-desktop/contracts";

export interface ClaudeSession {
  readonly sessionId: SessionId;
  readonly promptQueue: Queue.Queue<string>;
  readonly eventQueue: Queue.Queue<SessionEvent>;
  readonly interrupt: Effect.Effect<void>;
  readonly setModel: (model: ModelId) => void;
  readonly setPermissionMode: (mode: PermissionMode) => void;
  readonly respondToolApproval: (requestId: string, approved: boolean) => void;
  readonly respondPlanReview: (requestId: string, approved: boolean) => void;
}

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

export class ClaudeAdapterService extends Context.Tag("ClaudeAdapterService")<
  ClaudeAdapterService,
  {
    readonly startSession: (options: {
      cwd: string;
      model: ModelId;
      permissionMode: PermissionMode;
      prompt: string;
      sessionId?: SessionId;
    }) => Effect.Effect<ClaudeSession>;
  }
>() {}

export const ClaudeAdapterLive = Layer.succeed(ClaudeAdapterService, {
  startSession: (options) =>
    Effect.gen(function* () {
      const promptQueue = yield* Queue.unbounded<string>();
      const eventQueue = yield* Queue.unbounded<SessionEvent>();
      const pendingApprovals = new Map<string, PendingApproval>();
      const pendingPlanReviews = new Map<string, PendingApproval>();
      let currentModel = options.model;
      let currentPermissionMode = options.permissionMode;

      const sessionId = (options.sessionId ?? crypto.randomUUID()) as SessionId;

      const sdkOptions: ClaudeQueryOptions = {
        cwd: options.cwd,
        model: currentModel,
        permissionMode: currentPermissionMode as "default" | "plan",
        ...(options.sessionId ? { resume: true, sessionId: options.sessionId } : {}),
        abortController: new AbortController(),
        permissions: {
          canUseTool: async (toolName: string, toolInput: unknown) => {
            if (currentPermissionMode === "fullAccess") return true;
            const requestId = crypto.randomUUID();
            const request: ToolApprovalRequest = { toolName, toolInput, requestId };
            yield* Queue.offer(eventQueue, { type: "approval", request });
            return new Promise<boolean>((resolve) => {
              pendingApprovals.set(requestId, { resolve });
            });
          },
        },
      };

      const runtime = query({
        prompt: options.prompt,
        options: sdkOptions,
      });

      // Stream SDK messages in background
      const fiber = yield* Effect.fork(
        Effect.gen(function* () {
          for await (const message of runtime as AsyncIterable<SDKMessage>) {
            const event = mapSdkMessage(message);
            if (event) yield* Queue.offer(eventQueue, event);
          }
          yield* Queue.offer(eventQueue, {
            type: "stateChange",
            state: "idle",
          });
        }),
      );

      return {
        sessionId,
        promptQueue,
        eventQueue,
        interrupt: Effect.sync(() => {
          sdkOptions.abortController?.abort();
        }),
        setModel: (model: ModelId) => {
          currentModel = model;
        },
        setPermissionMode: (mode: PermissionMode) => {
          currentPermissionMode = mode;
        },
        respondToolApproval: (requestId: string, approved: boolean) => {
          const pending = pendingApprovals.get(requestId);
          if (pending) {
            pending.resolve(approved);
            pendingApprovals.delete(requestId);
          }
        },
        respondPlanReview: (requestId: string, approved: boolean) => {
          const pending = pendingPlanReviews.get(requestId);
          if (pending) {
            pending.resolve(approved);
            pendingPlanReviews.delete(requestId);
          }
        },
      } satisfies ClaudeSession;
    }),
});

function mapSdkMessage(message: SDKMessage): SessionEvent | null {
  switch (message.type) {
    case "stream_event": {
      const ev = message as any;
      if (ev.event?.type === "content_block_delta") {
        const delta = ev.event.delta;
        if (delta?.type === "text_delta") {
          return { type: "text", content: delta.text };
        }
        if (delta?.type === "thinking_delta") {
          return { type: "reasoning", content: delta.thinking };
        }
      }
      return null;
    }
    case "result":
      return { type: "turnComplete", usage: (message as any).usage ?? {} };
    default:
      return null;
  }
}
```

- [ ] **Step 6: Create apps/server/src/ws.ts — WebSocket RPC handler**

```ts
import { Effect, Layer, Stream } from "effect";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import { WsRpcGroup } from "@claude-desktop/contracts";
import { ClaudeAdapterService, type ClaudeSession } from "./claude/ClaudeAdapter";
import { checkAuthStatus } from "./claude/ClaudeProvider";
import type { SessionId } from "@claude-desktop/contracts";

const sessions = new Map<string, ClaudeSession>();

export const WsRpcHandlerLive = RpcServer.toHttpEffectWebsocket(WsRpcGroup)({
  startSession: (input) =>
    Effect.gen(function* () {
      const adapter = yield* ClaudeAdapterService;
      const session = yield* adapter.startSession({
        cwd: input.cwd,
        model: input.model,
        permissionMode: input.permissionMode,
        prompt: input.prompt,
        sessionId: input.sessionId,
      });
      sessions.set(session.sessionId, session);
      return session.sessionId;
    }),

  sendTurn: (input) =>
    Effect.gen(function* () {
      const session = sessions.get(input.sessionId);
      if (!session) return yield* Effect.fail({ _tag: "SessionError" as const, message: "Session not found" });
      yield* session.promptQueue.offer(input.prompt);
    }),

  stopSession: (input) =>
    Effect.gen(function* () {
      const session = sessions.get(input.sessionId);
      if (!session) return;
      yield* session.interrupt;
      sessions.delete(input.sessionId);
    }),

  setModel: (input) =>
    Effect.sync(() => {
      const session = sessions.get(input.sessionId);
      if (session) session.setModel(input.model);
    }),

  setPermissionMode: (input) =>
    Effect.sync(() => {
      const session = sessions.get(input.sessionId);
      if (session) session.setPermissionMode(input.permissionMode);
    }),

  respondToolApproval: (input) =>
    Effect.sync(() => {
      const session = sessions.get(input.requestId);
      // Find session that has this pending approval
      for (const s of sessions.values()) {
        s.respondToolApproval(input.requestId, input.approved);
      }
    }),

  respondPlanReview: (input) =>
    Effect.sync(() => {
      for (const s of sessions.values()) {
        s.respondPlanReview(input.requestId, input.approved);
      }
    }),

  getAuthStatus: () => checkAuthStatus(),

  subscribeSessionEvents: (input) =>
    Stream.fromEffect(
      Effect.sync(() => {
        const session = sessions.get(input.sessionId);
        if (!session) return Stream.fail({ _tag: "SessionError" as const, message: "Session not found" });
        return Stream.fromQueue(session.eventQueue);
      }),
    ).pipe(Stream.flatten()),
}).pipe(Layer.provide(RpcSerialization.layerJson));
```

- [ ] **Step 7: Create apps/server/src/server.ts — HTTP server with WS upgrade**

```ts
import { Effect, Layer } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeHttp from "node:http";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { ServerConfig } from "./config";
import { WsRpcHandlerLive } from "./ws";
import { ClaudeAdapterLive } from "./claude/ClaudeAdapter";

export const makeServerLayer = (config: { port: number }) =>
  Layer.mergeAll(
    NodeHttpServer.layer(NodeHttp.createServer, { port: config.port }),
    WsRpcHandlerLive,
    ClaudeAdapterLive,
  );
```

- [ ] **Step 8: Create apps/server/src/bin.ts — Entry point**

```ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, Layer } from "effect";
import { ServerConfig, ServerConfigFromEnv } from "./config";
import { makeServerLayer } from "./server";
import { NetService } from "@claude-desktop/shared/Net";

const program = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const net = yield* NetService;
  const port = config.port || (yield* net.findAvailablePort());

  console.log(`[server] starting on port ${port}`);

  // Server runs until interrupted
  yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.provide(ServerConfigFromEnv),
  Effect.provide(NetService.layer),
);

NodeRuntime.runMain(program);
```

- [ ] **Step 9: Install deps and commit**

```bash
bun install
git add apps/server
git commit -m "feat: add server app with Claude adapter, WS RPC, and Effect layers"
```

---

### Task 5: Web App — Terminal UI

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/env.ts`
- Create: `apps/web/src/rpc/wsTransport.ts`
- Create: `apps/web/src/components/Terminal.tsx`
- Create: `apps/web/src/components/InputBar.tsx`
- Create: `apps/web/src/components/ToolApproval.tsx`
- Create: `apps/web/src/components/ModelSelector.tsx`
- Create: `apps/web/src/components/Sidebar.tsx`
- Create: `apps/web/src/store/sessionStore.ts`
- Create: `apps/web/src/App.tsx`

- [ ] **Step 1: Create apps/web/package.json**

```json
{
  "name": "@claude-desktop/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@claude-desktop/contracts": "workspace:*",
    "@claude-desktop/shared": "workspace:*",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
    "effect": "catalog:",
    "lucide-react": "^0.564.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "catalog:",
    "vite": "^8.0.0"
  }
}
```

- [ ] **Step 2: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create apps/web/vite.config.ts**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const port = Number(process.env.PORT ?? 5733);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    "import.meta.env.VITE_WS_URL": JSON.stringify(process.env.VITE_WS_URL ?? ""),
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

- [ ] **Step 4: Create apps/web/index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Desktop</title>
  </head>
  <body class="bg-black text-white">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create apps/web/src/index.css**

```css
@import "tailwindcss";
@import "@xterm/xterm/css/xterm.css";

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  background: #0d1117;
  color: #e6edf3;
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
}
```

- [ ] **Step 6: Create apps/web/src/env.ts**

```ts
declare global {
  interface Window {
    desktopBridge?: {
      getWsUrl: () => string | null;
      pickFolder: () => Promise<string | null>;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export const isElectron = typeof window !== "undefined" && !!window.desktopBridge;

export function resolveWsUrl(): string {
  if (isElectron) {
    const url = window.desktopBridge!.getWsUrl();
    if (url) return url;
  }
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws`;
}
```

- [ ] **Step 7: Create apps/web/src/rpc/wsTransport.ts — WebSocket RPC client**

```ts
import { resolveWsUrl } from "../env";

type Listener = (event: any) => void;

export class WsTransport {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    const url = resolveWsUrl();
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      for (const listener of this.listeners) listener(data);
    };
    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  send(method: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ method, payload }));
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export const transport = new WsTransport();
```

- [ ] **Step 8: Create apps/web/src/store/sessionStore.ts — Zustand store**

```ts
import { create } from "zustand";
import type { SessionEvent, SessionState, ModelId, PermissionMode, ToolApprovalRequest, PlanReview } from "@claude-desktop/contracts";

interface SessionStore {
  sessionId: string | null;
  state: SessionState;
  events: SessionEvent[];
  model: ModelId;
  permissionMode: PermissionMode;
  pendingApproval: ToolApprovalRequest | null;
  pendingPlanReview: PlanReview | null;
  cwd: string;

  setSessionId: (id: string | null) => void;
  setState: (state: SessionState) => void;
  addEvent: (event: SessionEvent) => void;
  setModel: (model: ModelId) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  setPendingApproval: (req: ToolApprovalRequest | null) => void;
  setPendingPlanReview: (review: PlanReview | null) => void;
  setCwd: (cwd: string) => void;
  clearEvents: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessionId: null,
  state: "idle",
  events: [],
  model: "claude-sonnet-4-6",
  permissionMode: "default",
  pendingApproval: null,
  pendingPlanReview: null,
  cwd: process.cwd?.() ?? "/",

  setSessionId: (id) => set({ sessionId: id }),
  setState: (state) => set({ state }),
  addEvent: (event) => set((s) => ({ events: [...s.events, event] })),
  setModel: (model) => set({ model }),
  setPermissionMode: (mode) => set({ permissionMode: mode }),
  setPendingApproval: (req) => set({ pendingApproval: req }),
  setPendingPlanReview: (review) => set({ pendingPlanReview: review }),
  setCwd: (cwd) => set({ cwd }),
  clearEvents: () => set({ events: [] }),
}));
```

- [ ] **Step 9: Create apps/web/src/components/Terminal.tsx**

```tsx
import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useSessionStore } from "../store/sessionStore";

export function Terminal() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const events = useSessionStore((s) => s.events);
  const lastWrittenRef = useRef(0);

  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      cursorBlink: true,
      disableStdin: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(termRef.current);

    xtermRef.current = term;

    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    for (let i = lastWrittenRef.current; i < events.length; i++) {
      const event = events[i];
      switch (event.type) {
        case "text":
          term.write(event.content);
          break;
        case "reasoning":
          term.write(`\x1b[2m${event.content}\x1b[0m`);
          break;
        case "toolUse":
          term.write(`\r\n\x1b[33m⚡ ${event.toolName}\x1b[0m\r\n`);
          break;
        case "toolResult":
          term.write(`\x1b[32m✓ ${event.toolName}\x1b[0m\r\n`);
          break;
        case "error":
          term.write(`\r\n\x1b[31m✗ ${event.message}\x1b[0m\r\n`);
          break;
        case "turnComplete":
          term.write("\r\n\x1b[36m─── turn complete ───\x1b[0m\r\n");
          break;
      }
    }
    lastWrittenRef.current = events.length;
  }, [events]);

  return <div ref={termRef} className="flex-1 min-h-0" />;
}
```

- [ ] **Step 10: Create apps/web/src/components/InputBar.tsx**

```tsx
import { useState, useCallback, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";

export function InputBar() {
  const [input, setInput] = useState("");
  const state = useSessionStore((s) => s.state);
  const sessionId = useSessionStore((s) => s.sessionId);
  const model = useSessionStore((s) => s.model);
  const permissionMode = useSessionStore((s) => s.permissionMode);
  const cwd = useSessionStore((s) => s.cwd);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (!sessionId || state === "idle" || state === "stopped") {
      transport.send("startSession", {
        cwd,
        model,
        permissionMode,
        prompt: trimmed,
      });
    } else {
      transport.send("sendTurn", {
        sessionId,
        prompt: trimmed,
      });
    }
    setInput("");
  }, [input, sessionId, state, model, permissionMode, cwd]);

  const handleStop = useCallback(() => {
    if (sessionId) {
      transport.send("stopSession", { sessionId });
    }
  }, [sessionId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isRunning = state === "running";

  return (
    <div className="border-t border-gray-800 p-3 flex gap-2 items-end">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? "Claude is thinking..." : "Send a message..."}
        className="flex-1 bg-gray-900 text-white border border-gray-700 rounded-lg px-4 py-2 resize-none focus:outline-none focus:border-blue-500 font-mono text-sm"
        rows={1}
        disabled={state === "awaitingApproval" || state === "awaitingPlanReview"}
      />
      {isRunning ? (
        <button
          onClick={handleStop}
          className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white"
          title="Stop"
        >
          <Square size={18} />
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          title="Send"
        >
          <Send size={18} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 11: Create apps/web/src/components/ToolApproval.tsx**

```tsx
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Check, X } from "lucide-react";

export function ToolApproval() {
  const pending = useSessionStore((s) => s.pendingApproval);

  if (!pending) return null;

  const handleRespond = (approved: boolean) => {
    transport.send("respondToolApproval", {
      requestId: pending.requestId,
      approved,
    });
    useSessionStore.getState().setPendingApproval(null);
  };

  return (
    <div className="border-t border-yellow-800 bg-yellow-950/50 p-3">
      <div className="text-yellow-400 text-sm font-mono mb-2">
        ⚡ Tool approval: <span className="font-bold">{pending.toolName}</span>
      </div>
      <pre className="text-xs text-gray-400 bg-gray-900 p-2 rounded mb-2 overflow-auto max-h-32">
        {JSON.stringify(pending.toolInput, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => handleRespond(true)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-sm"
        >
          <Check size={14} /> Allow
        </button>
        <button
          onClick={() => handleRespond(false)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-sm"
        >
          <X size={14} /> Deny
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Create apps/web/src/components/ModelSelector.tsx**

```tsx
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import type { ModelId } from "@claude-desktop/contracts";

const MODELS: { id: ModelId; label: string }[] = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export function ModelSelector() {
  const model = useSessionStore((s) => s.model);
  const sessionId = useSessionStore((s) => s.sessionId);

  const handleChange = (newModel: ModelId) => {
    useSessionStore.getState().setModel(newModel);
    if (sessionId) {
      transport.send("setModel", { sessionId, model: newModel });
    }
  };

  return (
    <select
      value={model}
      onChange={(e) => handleChange(e.target.value as ModelId)}
      className="bg-gray-900 text-gray-300 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
    >
      {MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 13: Create apps/web/src/components/Sidebar.tsx — File explorer placeholder**

```tsx
import { useState } from "react";
import { FolderOpen, ChevronLeft, ChevronRight } from "lucide-react";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(true);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="p-2 text-gray-500 hover:text-gray-300"
        title="Open file explorer"
      >
        <ChevronRight size={16} />
      </button>
    );
  }

  return (
    <div className="w-64 border-r border-gray-800 flex flex-col bg-gray-950">
      <div className="flex items-center justify-between p-2 border-b border-gray-800">
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <FolderOpen size={14} />
          <span>Files</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-500 hover:text-gray-300"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
      <div className="flex-1 p-2 text-gray-500 text-xs">
        File explorer — coming soon
      </div>
    </div>
  );
}
```

- [ ] **Step 14: Create apps/web/src/App.tsx — Main layout**

```tsx
import { useEffect } from "react";
import { Terminal } from "./components/Terminal";
import { InputBar } from "./components/InputBar";
import { ToolApproval } from "./components/ToolApproval";
import { ModelSelector } from "./components/ModelSelector";
import { Sidebar } from "./components/Sidebar";
import { transport } from "./rpc/wsTransport";
import { useSessionStore } from "./store/sessionStore";

export function App() {
  const state = useSessionStore((s) => s.state);

  useEffect(() => {
    transport.connect();

    const unsubscribe = transport.subscribe((data) => {
      const store = useSessionStore.getState();

      if (data.sessionId && !store.sessionId) {
        store.setSessionId(data.sessionId);
      }

      if (data.type) {
        store.addEvent(data);

        if (data.type === "approval") {
          store.setPendingApproval(data.request);
          store.setState("awaitingApproval");
        } else if (data.type === "planReview") {
          store.setPendingPlanReview(data.review);
          store.setState("awaitingPlanReview");
        } else if (data.type === "stateChange") {
          store.setState(data.state);
        } else if (data.type === "text" || data.type === "reasoning") {
          store.setState("running");
        }
      }
    });

    return () => {
      unsubscribe();
      transport.disconnect();
    };
  }, []);

  const stateLabel: Record<string, string> = {
    idle: "Ready",
    running: "Running",
    awaitingApproval: "Awaiting Approval",
    awaitingPlanReview: "Plan Review",
    stopped: "Stopped",
  };

  return (
    <div className="h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-3">
            <span className="text-white font-mono font-bold text-sm">Claude Desktop</span>
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${
              state === "running" ? "bg-green-900 text-green-400" :
              state === "awaitingApproval" ? "bg-yellow-900 text-yellow-400" :
              "bg-gray-800 text-gray-400"
            }`}>
              {stateLabel[state] ?? state}
            </span>
          </div>
          <ModelSelector />
        </div>

        {/* Terminal */}
        <Terminal />

        {/* Tool approval bar */}
        <ToolApproval />

        {/* Input */}
        <InputBar />
      </div>
    </div>
  );
}
```

- [ ] **Step 15: Create apps/web/src/main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";

document.title = "Claude Desktop";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 16: Install deps and commit**

```bash
bun install
git add apps/web
git commit -m "feat: add web app with terminal UI, tool approval, model selector, and sidebar"
```

---

### Task 6: Desktop App — Electron Shell

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/tsdown.config.ts`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Create apps/desktop/package.json**

```json
{
  "name": "@claude-desktop/desktop",
  "version": "0.0.1",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "bun run --parallel dev:bundle dev:electron",
    "dev:bundle": "tsdown --watch",
    "dev:electron": "electron dist-electron/main.js",
    "build": "tsdown",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "effect": "catalog:",
    "electron": "40.6.0"
  },
  "devDependencies": {
    "@claude-desktop/contracts": "workspace:*",
    "@claude-desktop/shared": "workspace:*",
    "@types/node": "catalog:",
    "tsdown": "catalog:",
    "typescript": "catalog:"
  },
  "productName": "Claude Desktop"
}
```

- [ ] **Step 2: Create apps/desktop/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist-electron",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create apps/desktop/tsdown.config.ts**

```ts
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  format: "cjs",
  outDir: "dist-electron",
  clean: true,
  external: ["electron"],
});
```

- [ ] **Step 4: Create apps/desktop/src/preload.ts**

```ts
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@claude-desktop/contracts";

const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => {
    const result = ipcRenderer.sendSync(GET_WS_URL_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
} satisfies DesktopBridge);
```

- [ ] **Step 5: Create apps/desktop/src/main.ts — Electron main process**

```ts
import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { NetService } from "@claude-desktop/shared/Net";
import { RotatingFileSink } from "@claude-desktop/shared/logging";
import * as Effect from "effect/Effect";

const BASE_DIR = Path.join(OS.homedir(), ".claude-desktop");
const STATE_DIR = Path.join(BASE_DIR, "userdata");
const LOG_DIR = Path.join(STATE_DIR, "logs");
const DESKTOP_SCHEME = "claude-desktop";
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess.ChildProcess | null = null;
let backendPort = 0;
let backendAuthToken = "";
let backendWsUrl = "";

FS.mkdirSync(LOG_DIR, { recursive: true });
const desktopLog = new RotatingFileSink({ dir: LOG_DIR, prefix: "desktop" });
const backendLog = new RotatingFileSink({ dir: LOG_DIR, prefix: "backend" });

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  desktopLog.write(line);
  console.log(msg);
}

async function startBackend(): Promise<void> {
  const port = await Effect.runPromise(
    NetService.layer.pipe(
      Effect.provide as any,
      () => Effect.flatMap(NetService, (net) => net.findAvailablePort()),
      Effect.provide(NetService.layer),
    ),
  ).catch(() => 3100);

  backendPort = port as number || 3100;
  backendAuthToken = Crypto.randomBytes(32).toString("hex");
  backendWsUrl = `ws://127.0.0.1:${backendPort}/ws?token=${backendAuthToken}`;

  const serverEntry = isDevelopment
    ? Path.resolve(__dirname, "../../server/src/bin.ts")
    : Path.resolve(__dirname, "../../server/dist/bin.mjs");

  log(`Starting backend on port ${backendPort}`);

  backendProcess = ChildProcess.spawn(
    process.execPath,
    [serverEntry],
    {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        CLAUDE_DESKTOP_PORT: String(backendPort),
        CLAUDE_DESKTOP_AUTH_TOKEN: backendAuthToken,
        CLAUDE_DESKTOP_MODE: "desktop",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  backendProcess.stdout?.on("data", (chunk: Buffer) => {
    backendLog.write(chunk.toString());
  });

  backendProcess.stderr?.on("data", (chunk: Buffer) => {
    backendLog.write(chunk.toString());
  });

  backendProcess.on("exit", (code) => {
    log(`Backend exited with code ${code}`);
  });

  // Wait for server to be ready
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));
}

function createWindow(): void {
  if (!isDevelopment) {
    protocol.registerFileProtocol(DESKTOP_SCHEME, (request, callback) => {
      const url = request.url.replace(`${DESKTOP_SCHEME}://app/`, "");
      const filePath = Path.resolve(__dirname, "../../web/dist", url);
      callback({ path: filePath });
    });
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: Path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  ipcMain.on("desktop:get-ws-url", (event) => {
    event.returnValue = backendWsUrl;
  });

  ipcMain.handle("desktop:pick-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("desktop:open-external", async (_event, url: string) => {
    await shell.openExternal(url);
  });

  if (isDevelopment) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`${DESKTOP_SCHEME}://app/index.html`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  backendProcess?.kill();
  app.quit();
});

app.on("before-quit", () => {
  backendProcess?.kill();
});
```

- [ ] **Step 6: Install deps, build, and commit**

```bash
bun install
git add apps/desktop
git commit -m "feat: add desktop app with Electron shell, preload bridge, and backend spawning"
```

---

### Task 7: Integration — Dev Scripts & First Run

**Files:**
- Modify: `package.json` (add dev scripts)

- [ ] **Step 1: Update root package.json scripts**

Add to the `"scripts"` section:

```json
"dev:web": "turbo run dev --filter=@claude-desktop/web",
"dev:server": "turbo run dev --filter=@claude-desktop/server",
"dev:desktop": "turbo run dev --filter=@claude-desktop/desktop"
```

- [ ] **Step 2: Build contracts first**

```bash
cd /Users/cuongpham/ws/automation
bun run build:contracts  # or: cd packages/contracts && bun run build
```

- [ ] **Step 3: Run the web + server in dev mode**

```bash
# Terminal 1: Server
cd apps/server && bun run dev

# Terminal 2: Web
cd apps/web && VITE_WS_URL=ws://localhost:3100/ws bun run dev
```

- [ ] **Step 4: Verify the app loads at http://localhost:5733**

Expected: Dark terminal UI with header showing "Claude Desktop", model selector, input bar at bottom.

- [ ] **Step 5: Test sending a prompt**

Type a message in the input bar and press Enter. Verify:
- WebSocket connection established
- Claude Code CLI is spawned
- Streaming output appears in terminal

- [ ] **Step 6: Commit working integration**

```bash
git add -A
git commit -m "feat: integrate all apps — dev mode working with web + server"
```

---

### Task 8: Plan Review UI

**Files:**
- Create: `apps/web/src/components/PlanReview.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create apps/web/src/components/PlanReview.tsx**

```tsx
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Check, X } from "lucide-react";

export function PlanReviewPanel() {
  const pending = useSessionStore((s) => s.pendingPlanReview);

  if (!pending) return null;

  const handleRespond = (approved: boolean) => {
    transport.send("respondPlanReview", {
      requestId: pending.requestId,
      approved,
    });
    useSessionStore.getState().setPendingPlanReview(null);
  };

  return (
    <div className="border-t border-blue-800 bg-blue-950/50 p-3 max-h-64 overflow-auto">
      <div className="text-blue-400 text-sm font-mono mb-2">📋 Plan Review</div>
      <pre className="text-xs text-gray-300 bg-gray-900 p-3 rounded mb-2 whitespace-pre-wrap">
        {pending.planMarkdown}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => handleRespond(true)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-sm"
        >
          <Check size={14} /> Approve Plan
        </button>
        <button
          onClick={() => handleRespond(false)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-sm"
        >
          <X size={14} /> Reject
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add PlanReviewPanel to App.tsx**

In `apps/web/src/App.tsx`, add import:

```tsx
import { PlanReviewPanel } from "./components/PlanReview";
```

And add `<PlanReviewPanel />` right after `<ToolApproval />`:

```tsx
<ToolApproval />
<PlanReviewPanel />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PlanReview.tsx apps/web/src/App.tsx
git commit -m "feat: add plan review UI panel"
```

---

### Task 9: Permission Mode Toggle

**Files:**
- Create: `apps/web/src/components/PermissionToggle.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create apps/web/src/components/PermissionToggle.tsx**

```tsx
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import type { PermissionMode } from "@claude-desktop/contracts";
import { Shield, ShieldCheck, ShieldOff } from "lucide-react";

const MODES: { id: PermissionMode; label: string; icon: typeof Shield }[] = [
  { id: "default", label: "Default", icon: Shield },
  { id: "plan", label: "Plan", icon: ShieldCheck },
  { id: "fullAccess", label: "Full Access", icon: ShieldOff },
];

export function PermissionToggle() {
  const mode = useSessionStore((s) => s.permissionMode);
  const sessionId = useSessionStore((s) => s.sessionId);

  const handleChange = (newMode: PermissionMode) => {
    useSessionStore.getState().setPermissionMode(newMode);
    if (sessionId) {
      transport.send("setPermissionMode", { sessionId, permissionMode: newMode });
    }
  };

  const current = MODES.find((m) => m.id === mode) ?? MODES[0];
  const Icon = current.icon;

  return (
    <div className="flex items-center gap-1">
      <Icon size={14} className="text-gray-500" />
      <select
        value={mode}
        onChange={(e) => handleChange(e.target.value as PermissionMode)}
        className="bg-gray-900 text-gray-300 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
      >
        {MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Add PermissionToggle to App.tsx header**

In `apps/web/src/App.tsx`, add import:

```tsx
import { PermissionToggle } from "./components/PermissionToggle";
```

Add `<PermissionToggle />` next to `<ModelSelector />` in the header:

```tsx
<div className="flex items-center gap-3">
  <PermissionToggle />
  <ModelSelector />
</div>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PermissionToggle.tsx apps/web/src/App.tsx
git commit -m "feat: add permission mode toggle (default/plan/full-access)"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Full build**

```bash
cd /Users/cuongpham/ws/automation
bun install
bun run build
```

Expected: All packages and apps build successfully.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: No type errors.

- [ ] **Step 3: Run dev mode end-to-end**

```bash
# Build contracts first
cd packages/contracts && bun run build && cd ../..

# Start server
cd apps/server && bun run dev &

# Start web
cd apps/web && VITE_WS_URL=ws://localhost:3100/ws bun run dev
```

Verify:
- Web UI loads at localhost:5733
- Can send prompts to Claude Code
- Streaming output displays in xterm.js terminal
- Tool approval UI shows when Claude requests permission
- Model selector changes model
- Permission toggle works
- Stop button cancels running session

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: final verification — all apps building and running"
```
