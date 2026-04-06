import { useEffect } from "react";
import { Terminal } from "./Terminal";
import { InputBar } from "./InputBar";
import { ToolApproval } from "./ToolApproval";
import { PlanReviewPanel } from "./PlanReview";
import { ModelSelector } from "./ModelSelector";
import { PermissionToggle } from "./PermissionToggle";
import { Sidebar } from "./Sidebar";
import { transport } from "../rpc/wsTransport";
import { useSessionStore } from "../store/sessionStore";
import { Badge } from "~/components/ui/badge";
import { Separator } from "~/components/ui/separator";

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { _tag: string; message: string };
}

interface SessionEvent {
  type: string;
  request?: unknown;
  review?: unknown;
  state?: string;
  [key: string]: unknown;
}

export function App() {
  const state = useSessionStore((s) => s.state);

  useEffect(() => {
    transport.connect();
    const unsubscribe = transport.subscribe((raw: unknown) => {
      const data = raw as RpcResponse;
      const store = useSessionStore.getState();

      if (
        data.result &&
        typeof data.result === "string" &&
        !store.sessionId
      ) {
        store.setSessionId(data.result);
        transport.send("subscribeSessionEvents", {
          sessionId: data.result,
        });
        store.setState("running");
        return;
      }

      if (
        data.result &&
        typeof data.result === "object" &&
        data.result !== null &&
        "type" in data.result
      ) {
        const event = data.result as SessionEvent;
        store.addEvent(event);

        if (event.type === "approval") {
          store.setPendingApproval(event.request);
          store.setState("awaitingApproval");
        } else if (event.type === "planReview") {
          store.setPendingPlanReview(event.review);
          store.setState("awaitingPlanReview");
        } else if (event.type === "stateChange") {
          if (
            typeof event.state === "string" &&
            ["idle", "running", "awaitingApproval", "awaitingPlanReview", "stopped"].includes(event.state)
          ) {
            store.setState(event.state as ReturnType<typeof useSessionStore.getState>["state"]);
          }
        } else if (event.type === "text" || event.type === "reasoning") {
          if (store.state !== "running") store.setState("running");
        }
      }

      if (data.error) {
        store.addEvent({
          type: "error",
          message: data.error.message,
        });
      }
    });
    return () => {
      unsubscribe();
      transport.disconnect();
    };
  }, []);

  const stateVariant =
    state === "running"
      ? "success"
      : state === "awaitingApproval"
        ? "warning"
        : "secondary";

  const stateLabel: Record<string, string> = {
    idle: "Ready",
    running: "Running",
    awaitingApproval: "Awaiting Approval",
    awaitingPlanReview: "Plan Review",
    stopped: "Stopped",
  };

  return (
    <div className="h-screen flex bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-sm text-foreground">
              Claude Desktop
            </span>
            <Badge variant={stateVariant}>
              {stateLabel[state] ?? state}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <PermissionToggle />
            <Separator orientation="vertical" className="h-5" />
            <ModelSelector />
          </div>
        </div>
        <Terminal />
        <ToolApproval />
        <PlanReviewPanel />
        <InputBar />
      </div>
    </div>
  );
}
