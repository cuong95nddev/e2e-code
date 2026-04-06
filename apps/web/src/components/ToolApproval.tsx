import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Check, X } from "lucide-react";

interface PendingApproval {
  requestId: string;
  toolName: string;
  toolInput: unknown;
}

export function ToolApproval() {
  const pending = useSessionStore((s) => s.pendingApproval) as PendingApproval | null;

  if (!pending) return null;

  const handleRespond = (approved: boolean) => {
    transport.send("respondToolApproval", {
      sessionId: useSessionStore.getState().sessionId,
      requestId: pending.requestId,
      approved,
    });
    useSessionStore.getState().setPendingApproval(null);
  };

  return (
    <div className="border-t border-yellow-800 bg-yellow-950/50 p-3">
      <div className="text-yellow-400 text-sm font-mono mb-2">
        ⚡ Tool approval:{" "}
        <span className="font-bold">{pending.toolName}</span>
      </div>
      <pre className="text-xs text-gray-400 bg-gray-900 p-2 rounded mb-2 overflow-auto max-h-32">
        {JSON.stringify(pending.toolInput, null, 2)}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => handleRespond(true)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-sm"
        >
          <Check size={14} /> Allow
        </button>
        <button
          onClick={() => handleRespond(false)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-sm"
        >
          <X size={14} /> Deny
        </button>
      </div>
    </div>
  );
}
