import { Schema } from "effect";

export const ProviderKind = Schema.Literal("claudeAgent");
export type ProviderKind = typeof ProviderKind.Type;

export const PermissionMode = Schema.Literals(["default", "plan", "fullAccess"]);
export type PermissionMode = typeof PermissionMode.Type;

export const ModelId = Schema.Literals([
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
]);
export type ModelId = typeof ModelId.Type;

export const AuthStatus = Schema.Struct({
  authenticated: Schema.Boolean,
  subscriptionType: Schema.optional(Schema.String),
  authMethod: Schema.optional(Schema.String),
});
export type AuthStatus = typeof AuthStatus.Type;
