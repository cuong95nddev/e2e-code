import * as Net from "node:net";
import { Effect, Layer, ServiceMap } from "effect";

export class NetService extends ServiceMap.Service<
  NetService,
  {
    readonly findAvailablePort: (preferred?: number) => Effect.Effect<number>;
  }
>()("NetService") {}

export const NetServiceLive: Layer.Layer<NetService> = Layer.succeed(NetService)({
  findAvailablePort: (preferred?: number) =>
    Effect.callback<number>((resume) => {
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
