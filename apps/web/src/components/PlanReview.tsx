import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Check, X } from "lucide-react";

interface PendingPlanReview {
  requestId: string;
  planMarkdown: string;
}

export function PlanReviewPanel() {
  const pending = useSessionStore((s) => s.pendingPlanReview) as PendingPlanReview | null;
  if (!pending) return null;

  const handleRespond = (approved: boolean) => {
    transport.send("respondPlanReview", {
      sessionId: useSessionStore.getState().sessionId,
      requestId: pending.requestId,
      approved,
    });
    useSessionStore.getState().setPendingPlanReview(null);
  };

  return (
    <div className="border-t border-blue-800 bg-blue-950/50 p-3 max-h-64 overflow-auto">
      <div className="text-blue-400 text-sm font-mono mb-2">Plan Review</div>
      <pre className="text-xs text-gray-300 bg-gray-900 p-3 rounded mb-2 whitespace-pre-wrap">
        {pending.planMarkdown}
      </pre>
      <div className="flex gap-2">
        <button onClick={() => handleRespond(true)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-sm">
          <Check size={14} /> Approve Plan
        </button>
        <button onClick={() => handleRespond(false)}
          className="flex items-center gap-1 px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-sm">
          <X size={14} /> Reject
        </button>
      </div>
    </div>
  );
}
