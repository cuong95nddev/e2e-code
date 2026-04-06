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
