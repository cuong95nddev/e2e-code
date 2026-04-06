import * as http from "node:http";
import * as net from "node:net";
import { Effect } from "effect";
import { ServerConfig } from "./config";
import { ClaudeAdapter } from "./claude/ClaudeAdapter";
import { handleUpgrade } from "./ws";
import { NetService } from "@claude-desktop/shared/Net";

export class HttpServer {
  constructor(
    readonly server: http.Server,
    readonly port: number,
    readonly url: string,
  ) {}
}

export const startServer: Effect.Effect<
  HttpServer,
  never,
  ServerConfig | ClaudeAdapter | NetService
> = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const adapter = yield* ClaudeAdapter;
  const netSvc = yield* NetService;

  // Find available port
  const port =
    config.port > 0
      ? config.port
      : yield* netSvc.findAvailablePort(config.port || undefined);

  const server = http.createServer((_req, res) => {
    if (_req.url === "/health" || _req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port }));
      return;
    }
    res.writeHead(404);
    res.end("Not Found");
  });

  // WebSocket upgrade
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) {
      handleUpgrade(req, socket as net.Socket, head, adapter, config.authToken);
    } else {
      (socket as net.Socket).destroy();
    }
  });

  // Listen
  yield* Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        server.listen(port, "127.0.0.1", () => resolve());
        server.on("error", reject);
      }),
  );

  const url = `http://127.0.0.1:${port}`;
  yield* Effect.log(`Server listening on ${url}`);
  yield* Effect.log(`WebSocket endpoint: ws://127.0.0.1:${port}/ws`);

  return new HttpServer(server, port, url);
});
