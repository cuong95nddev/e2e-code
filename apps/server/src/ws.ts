/**
 * WebSocket RPC handler
 *
 * Routes JSON-RPC style messages over WebSocket to the appropriate handlers.
 * Uses manual WebSocket framing over raw TCP since Effect's RpcServer WebSocket
 * API is not stable in v4 beta.
 */
import * as http from "node:http";
import * as crypto from "node:crypto";
import * as net from "node:net";
import { Effect, Queue } from "effect";
import type { SessionId } from "@claude-desktop/contracts";
import type { ClaudeSession } from "./claude/ClaudeAdapter";
import { checkAuthStatus } from "./claude/ClaudeProvider";

// ---------- Types ----------

interface RpcRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  id: string | number;
  result?: unknown;
  error?: { _tag: string; message: string };
}

/** The shape of the ClaudeAdapter service methods, used to avoid depending on the Effect service type */
export interface AdapterActions {
  readonly startSession: (opts: {
    sessionId: SessionId;
    cwd: string;
    model: any;
    permissionMode: any;
    prompt: string;
  }) => Effect.Effect<ClaudeSession>;
  readonly getSession: (sessionId: SessionId) => Effect.Effect<ClaudeSession | undefined>;
  readonly stopSession: (sessionId: SessionId) => Effect.Effect<void>;
}

// ---------- WebSocket upgrade handler ----------

export function handleUpgrade(
  req: http.IncomingMessage,
  socket: net.Socket,
  _head: Buffer,
  adapter: AdapterActions,
  authToken: string,
): void {
  // Auth check
  if (authToken) {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const token =
      url.searchParams.get("token") ??
      req.headers["authorization"]?.replace("Bearer ", "");
    if (token !== authToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  // Perform WebSocket handshake
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-5AB9DC11235B")
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      "\r\n",
  );

  // Set up message handling
  const sendJson = (data: RpcResponse) => {
    const json = JSON.stringify(data);
    const buf = Buffer.from(json, "utf-8");
    const frame = encodeFrame(buf);
    if (!socket.destroyed) {
      socket.write(frame);
    }
  };

  // Active event subscriptions
  const subscriptions = new Map<string, boolean>();

  socket.on("data", (raw: Buffer) => {
    const messages = decodeFrames(raw);
    for (const msgBuf of messages) {
      let parsed: RpcRequest;
      try {
        parsed = JSON.parse(msgBuf.toString("utf-8"));
      } catch {
        continue;
      }
      const effect = handleRpcMessage(parsed, adapter, subscriptions, sendJson);
      Effect.runFork(effect);
    }
  });

  socket.on("close", () => {
    for (const [k] of subscriptions) {
      subscriptions.set(k, false);
    }
    subscriptions.clear();
  });
}

// ---------- RPC message router ----------

function handleRpcMessage(
  req: RpcRequest,
  adapter: AdapterActions,
  subscriptions: Map<string, boolean>,
  send: (resp: RpcResponse) => void,
): Effect.Effect<void> {
  const ok = (result: unknown) => send({ id: req.id, result });
  const err = (message: string) =>
    send({ id: req.id, error: { _tag: "SessionError", message } });

  const params = req.params ?? {};

  const safeCatch = (eff: Effect.Effect<void>): Effect.Effect<void> =>
    eff.pipe(Effect.catchCause((cause) => Effect.sync(() => err(String(cause)))));

  switch (req.method) {
    case "startSession":
      return safeCatch(
        Effect.gen(function* () {
          const sessionId = ((params.sessionId as string) ?? crypto.randomUUID()) as SessionId;
          const session = yield* adapter.startSession({
            sessionId,
            cwd: params.cwd as string,
            model: params.model,
            permissionMode: params.permissionMode,
            prompt: params.prompt as string,
          });
          ok(session.sessionId);
        }),
      );

    case "sendTurn":
      return safeCatch(
        Effect.gen(function* () {
          const session = yield* adapter.getSession(params.sessionId as SessionId);
          if (!session) return err("Session not found");
          yield* Queue.offer(session.promptQueue, params.prompt as string);
          ok(undefined);
        }),
      );

    case "stopSession":
      return safeCatch(
        Effect.gen(function* () {
          yield* adapter.stopSession(params.sessionId as SessionId);
          ok(undefined);
        }),
      );

    case "setModel":
      return safeCatch(
        Effect.gen(function* () {
          const session = yield* adapter.getSession(params.sessionId as SessionId);
          if (!session) return err("Session not found");
          session.setModel(params.model as any);
          ok(undefined);
        }),
      );

    case "setPermissionMode":
      return safeCatch(
        Effect.gen(function* () {
          const session = yield* adapter.getSession(params.sessionId as SessionId);
          if (!session) return err("Session not found");
          session.setPermissionMode(params.permissionMode as any);
          ok(undefined);
        }),
      );

    case "respondToolApproval":
      return safeCatch(
        Effect.gen(function* () {
          const session = yield* adapter.getSession(params.sessionId as SessionId);
          if (!session) return err("Session not found");
          session.respondToolApproval(
            params.requestId as string,
            params.approved as boolean,
          );
          ok(undefined);
        }),
      );

    case "respondPlanReview":
      return safeCatch(
        Effect.gen(function* () {
          const session = yield* adapter.getSession(params.sessionId as SessionId);
          if (!session) return err("Session not found");
          session.respondPlanReview(
            params.requestId as string,
            params.approved as boolean,
          );
          ok(undefined);
        }),
      );

    case "getAuthStatus":
      return safeCatch(
        Effect.gen(function* () {
          const status = yield* checkAuthStatus();
          ok(status);
        }),
      );

    case "subscribeSessionEvents":
      return safeCatch(
        Effect.gen(function* () {
          const sessionId = params.sessionId as string;
          const session = yield* adapter.getSession(sessionId as SessionId);
          if (!session) return err("Session not found");

          const subKey = `${req.id}:${sessionId}`;
          subscriptions.set(subKey, true);

          yield* Effect.forkChild(
            Effect.gen(function* () {
              while (subscriptions.get(subKey)) {
                const event = yield* Queue.take(session.eventQueue);
                send({ id: req.id, result: event as unknown });
                if (event.type === "stateChange" && event.state === "stopped") {
                  subscriptions.delete(subKey);
                  break;
                }
              }
            }),
          );
        }),
      );

    default:
      return Effect.sync(() => err(`Unknown method: ${req.method}`));
  }
}

// ---------- WebSocket frame encoding/decoding ----------

function encodeFrame(data: Buffer): Buffer {
  const len = data.length;
  let header: Buffer;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, data]);
}

function decodeFrames(data: Buffer): Buffer[] {
  const results: Buffer[] = [];
  let offset = 0;

  while (offset < data.length) {
    if (offset + 2 > data.length) break;

    const firstByte = data[offset]!;
    const secondByte = data[offset + 1]!;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    offset += 2;

    if (payloadLen === 126) {
      if (offset + 2 > data.length) break;
      payloadLen = data.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLen === 127) {
      if (offset + 8 > data.length) break;
      payloadLen = Number(data.readBigUInt64BE(offset));
      offset += 8;
    }

    let maskKey: Buffer | undefined;
    if (masked) {
      if (offset + 4 > data.length) break;
      maskKey = data.subarray(offset, offset + 4);
      offset += 4;
    }

    if (offset + payloadLen > data.length) break;
    const payload = Buffer.alloc(payloadLen);
    data.copy(payload, 0, offset, offset + payloadLen);

    if (maskKey) {
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = payload[i]! ^ maskKey[i % 4]!;
      }
    }

    const opcode = firstByte & 0x0f;
    if (opcode === 0x08) {
      break;
    }
    if (opcode === 0x01 || opcode === 0x02) {
      results.push(payload);
    }

    offset += payloadLen;
  }

  return results;
}
