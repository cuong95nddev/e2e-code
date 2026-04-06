import { Layer, ServiceMap } from "effect";

export class ServerConfig extends ServiceMap.Service<
  ServerConfig,
  {
    readonly port: number;
    readonly authToken: string;
    readonly mode: "standalone" | "desktop";
  }
>()("ServerConfig") {}

export const ServerConfigFromEnv = Layer.succeed(ServerConfig)({
  port: Number(process.env.CLAUDE_DESKTOP_PORT ?? "0"),
  authToken: process.env.CLAUDE_DESKTOP_AUTH_TOKEN ?? "",
  mode: (process.env.CLAUDE_DESKTOP_MODE ?? "standalone") as "standalone" | "desktop",
});
