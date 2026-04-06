import { Effect, Layer, Queue, ServiceMap, Fiber, Ref } from "effect";
import {
  query,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
  type Query,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  SessionId,
  SessionEvent,
  PermissionMode,
  ModelId,
} from "@claude-desktop/contracts";

// ---------- Types ----------

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

// ---------- Service ----------

export class ClaudeAdapter extends ServiceMap.Service<
  ClaudeAdapter,
  {
    readonly startSession: (opts: {
      sessionId: SessionId;
      cwd: string;
      model: ModelId;
      permissionMode: PermissionMode;
      prompt: string;
    }) => Effect.Effect<ClaudeSession>;
    readonly getSession: (sessionId: SessionId) => Effect.Effect<ClaudeSession | undefined>;
    readonly stopSession: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()("ClaudeAdapter") {}

// ---------- Helpers ----------

function mapPermissionMode(mode: PermissionMode): NonNullable<ClaudeQueryOptions["permissionMode"]> {
  switch (mode) {
    case "fullAccess":
      return "acceptEdits";
    case "plan":
      return "plan";
    default:
      return "default";
  }
}

/** Consume an async generator inside Effect via Effect.promise */
function consumeQuery(
  q: Query,
  eventQueue: Queue.Queue<SessionEvent>,
  pendingApprovals: Map<string, { resolve: (result: PermissionResult) => void }>,
): Effect.Effect<void> {
  return Effect.promise(async () => {
    for await (const msg of q) {
      processSDKMessageSync(msg, eventQueue, pendingApprovals);
    }
  });
}

// ---------- Live implementation ----------

export const ClaudeAdapterLive: Layer.Layer<ClaudeAdapter> = Layer.effect(ClaudeAdapter)(
  Effect.gen(function* () {
    const sessions = yield* Ref.make<Map<string, ClaudeSession>>(new Map());

    const impl = {
      startSession: (opts: {
        sessionId: SessionId;
        cwd: string;
        model: ModelId;
        permissionMode: PermissionMode;
        prompt: string;
      }): Effect.Effect<ClaudeSession> =>
        Effect.gen(function* () {
          const eventQueue = yield* Queue.unbounded<SessionEvent>();
          const promptQueue = yield* Queue.unbounded<string>();

          let currentModel: ModelId = opts.model;
          let currentPermissionMode: PermissionMode = opts.permissionMode;
          const pendingApprovals = new Map<
            string,
            { resolve: (result: PermissionResult) => void }
          >();

          let activeQuery: Query | null = null;

          // Push initial prompt
          yield* Queue.offer(promptQueue, opts.prompt);

          // Notify state change
          yield* Queue.offer(eventQueue, { type: "stateChange", state: "running" });

          // Start the session loop in a fiber
          const sessionFiber = yield* Effect.forkChild(
            Effect.gen(function* () {
              // Process prompts from the queue
              while (true) {
                const prompt = yield* Queue.take(promptQueue);

                try {
                  Effect.runSync(
                    Queue.offer(eventQueue, {
                      type: "stateChange",
                      state: "running",
                    }),
                  );

                  activeQuery = query({
                    prompt,
                    options: {
                      cwd: opts.cwd,
                      model: currentModel,
                      permissionMode: mapPermissionMode(currentPermissionMode),
                      canUseTool: async (toolName, toolInput, _canUseToolOptions) => {
                        // Generate a request ID for this approval
                        const requestId = crypto.randomUUID();

                        // Push approval request to event queue
                        Effect.runSync(
                          Queue.offer(eventQueue, {
                            type: "approval",
                            request: {
                              toolName,
                              toolInput,
                              requestId,
                            },
                          }),
                        );

                        Effect.runSync(
                          Queue.offer(eventQueue, {
                            type: "stateChange",
                            state: "awaitingApproval",
                          }),
                        );

                        // Wait for approval response via promise
                        return new Promise<PermissionResult>((resolve) => {
                          pendingApprovals.set(requestId, { resolve });
                        });
                      },
                    },
                  });

                  // Consume the async generator via Effect.promise
                  yield* consumeQuery(activeQuery, eventQueue, pendingApprovals);

                  activeQuery = null;

                  yield* Queue.offer(eventQueue, {
                    type: "turnComplete",
                    usage: {},
                  });
                } catch (err: unknown) {
                  activeQuery = null;
                  const message = err instanceof Error ? err.message : String(err);
                  yield* Queue.offer(eventQueue, {
                    type: "error",
                    message,
                  });
                }

                yield* Queue.offer(eventQueue, {
                  type: "stateChange",
                  state: "idle",
                });
              }
            }),
          );

          const session: ClaudeSession = {
            sessionId: opts.sessionId,
            promptQueue,
            eventQueue,
            interrupt: Effect.gen(function* () {
              if (activeQuery) {
                yield* Effect.promise(() => activeQuery!.return(undefined));
                activeQuery = null;
              }
              yield* Fiber.interrupt(sessionFiber);
            }).pipe(Effect.asVoid),
            setModel: (model) => {
              currentModel = model;
              activeQuery?.setModel(model).catch(() => {});
            },
            setPermissionMode: (mode) => {
              currentPermissionMode = mode;
              activeQuery
                ?.setPermissionMode(mapPermissionMode(mode))
                .catch(() => {});
            },
            respondToolApproval: (requestId, approved) => {
              const pending = pendingApprovals.get(requestId);
              if (pending) {
                pendingApprovals.delete(requestId);
                if (approved) {
                  pending.resolve({ behavior: "allow" });
                } else {
                  pending.resolve({
                    behavior: "deny",
                    message: "User denied the tool use",
                  });
                }
              }
            },
            respondPlanReview: (requestId, approved) => {
              // Plan review reuses the same approval mechanism
              const pending = pendingApprovals.get(requestId);
              if (pending) {
                pendingApprovals.delete(requestId);
                if (approved) {
                  pending.resolve({ behavior: "allow" });
                } else {
                  pending.resolve({
                    behavior: "deny",
                    message: "User rejected the plan",
                    interrupt: true,
                  });
                }
              }
            },
          };

          yield* Ref.update(sessions, (m) => new Map(m).set(opts.sessionId, session));
          return session;
        }),

      getSession: (sessionId: SessionId): Effect.Effect<ClaudeSession | undefined> =>
        Ref.get(sessions).pipe(Effect.map((m) => m.get(sessionId))),

      stopSession: (sessionId: SessionId): Effect.Effect<void> =>
        Effect.gen(function* () {
          const map = yield* Ref.get(sessions);
          const session = map.get(sessionId);
          if (session) {
            yield* session.interrupt;
            yield* Ref.update(sessions, (m) => {
              const next = new Map(m);
              next.delete(sessionId);
              return next;
            });
          }
        }),
    } as const;

    return impl;
  }),
);

// ---------- SDK message processing (sync push to queue) ----------

function processSDKMessageSync(
  msg: SDKMessage,
  eventQueue: Queue.Queue<SessionEvent>,
  _pendingApprovals: Map<string, { resolve: (result: PermissionResult) => void }>,
): void {
  switch (msg.type) {
    case "assistant": {
      const message = msg.message;
      if (message && "content" in message && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === "text") {
            Effect.runSync(
              Queue.offer(eventQueue, { type: "text", content: block.text }),
            );
          } else if (block.type === "thinking") {
            Effect.runSync(
              Queue.offer(eventQueue, {
                type: "reasoning",
                content: (block as any).thinking ?? "",
              }),
            );
          } else if (block.type === "tool_use") {
            Effect.runSync(
              Queue.offer(eventQueue, {
                type: "toolUse",
                toolName: (block as any).name ?? "unknown",
                input: (block as any).input ?? {},
              }),
            );
          }
        }
      }
      break;
    }

    case "user": {
      if (msg.tool_use_result != null) {
        const result = msg.tool_use_result;
        Effect.runSync(
          Queue.offer(eventQueue, {
            type: "toolResult",
            toolName: "unknown",
            output: typeof result === "string" ? result : JSON.stringify(result),
          }),
        );
      }
      break;
    }

    case "result": {
      if (msg.subtype === "success") {
        Effect.runSync(
          Queue.offer(eventQueue, {
            type: "turnComplete",
            usage: msg.usage,
          }),
        );
      } else {
        const errors = "errors" in msg ? msg.errors : [];
        Effect.runSync(
          Queue.offer(eventQueue, {
            type: "error",
            message: Array.isArray(errors) && errors.length > 0
              ? errors.join("; ")
              : `Query ended with: ${msg.subtype}`,
          }),
        );
      }
      break;
    }

    case "system": {
      if ("subtype" in msg && msg.subtype === "session_state_changed") {
        const state = (msg as any).state;
        if (state === "idle" || state === "stopped") {
          Effect.runSync(
            Queue.offer(eventQueue, { type: "stateChange", state }),
          );
        }
      }
      break;
    }

    default:
      break;
  }
}
