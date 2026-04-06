import { Schema } from "effect";
import { PermissionMode, ModelId } from "./provider";

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const SessionState = Schema.Literals([
  "idle",
  "running",
  "awaitingApproval",
  "awaitingPlanReview",
  "stopped",
]);
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

export const SessionEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), content: Schema.String }),
  Schema.Struct({ type: Schema.Literal("reasoning"), content: Schema.String }),
  Schema.Struct({ type: Schema.Literal("toolUse"), toolName: Schema.String, input: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("toolResult"), toolName: Schema.String, output: Schema.String }),
  Schema.Struct({ type: Schema.Literal("approval"), request: ToolApprovalRequest }),
  Schema.Struct({ type: Schema.Literal("planReview"), review: PlanReview }),
  Schema.Struct({ type: Schema.Literal("turnComplete"), usage: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stateChange"), state: SessionState }),
]);
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
