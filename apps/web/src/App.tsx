import { useEffect } from "react";
import { Terminal } from "./components/Terminal";
import { InputBar } from "./components/InputBar";
import { ToolApproval } from "./components/ToolApproval";
import { PlanReviewPanel } from "./components/PlanReview";
import { ModelSelector } from "./components/ModelSelector";
import { Sidebar } from "./components/Sidebar";
import { transport } from "./rpc/wsTransport";
import { useSessionStore } from "./store/sessionStore";

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

      // Handle startSession response — result is the sessionId
      if (
        data.result &&
        typeof data.result === "string" &&
        !store.sessionId
      ) {
        store.setSessionId(data.result);
        // Subscribe to events for this session
        transport.send("subscribeSessionEvents", {
          sessionId: data.result,
        });
        store.setState("running");
        return;
      }

      // Handle streaming session events
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

      // Handle errors
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

  const stateLabel: Record<string, string> = {
    idle: "Ready",
    running: "Running",
    awaitingApproval: "Awaiting Approval",
    awaitingPlanReview: "Plan Review",
    stopped: "Stopped",
  };

  return (
    <div className="h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-3">
            <span className="text-white font-mono font-bold text-sm">
              Claude Desktop
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono ${
                state === "running"
                  ? "bg-green-900 text-green-400"
                  : state === "awaitingApproval"
                    ? "bg-yellow-900 text-yellow-400"
                    : "bg-gray-800 text-gray-400"
              }`}
            >
              {stateLabel[state] ?? state}
            </span>
          </div>
          <ModelSelector />
        </div>
        <Terminal />
        <ToolApproval />
        <PlanReviewPanel />
        <InputBar />
      </div>
    </div>
  );
}
