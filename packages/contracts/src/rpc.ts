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
  Rpc.make("subscribeSessionEvents", {
    payload: Schema.Struct({ sessionId: SessionId }),
    success: SessionEvent,
    error: SessionError,
    stream: true,
  }),
);
