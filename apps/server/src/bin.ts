import { Effect, Layer } from "effect";
import { ServerConfigFromEnv } from "./config";
import { ClaudeAdapterLive } from "./claude/ClaudeAdapter";
import { startServer } from "./server";
import { NetServiceLive } from "@claude-desktop/shared/Net";

const MainLive = Layer.mergeAll(ServerConfigFromEnv, ClaudeAdapterLive, NetServiceLive);

const program = Effect.gen(function* () {
  const httpServer = yield* startServer;
  yield* Effect.log(`Claude Desktop Server started on ${httpServer.url}`);

  // Keep the process alive until interrupted
  yield* Effect.never;
});

Effect.runFork(
  program.pipe(
    Effect.provide(MainLive),
    Effect.catchCause((cause) => {
      console.error("Server failed:", cause);
      return Effect.void;
    }),
  ),
);
