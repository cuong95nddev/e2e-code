import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Check, X, FileText } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { ScrollArea } from "~/components/ui/scroll-area";

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
    <div className="border-t border-info/32 bg-info/4 p-3">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="size-4 text-info" />
        <span className="text-sm font-medium text-info-foreground">Plan Review</span>
      </div>
      <ScrollArea className="max-h-56">
        <Card className="p-3 mb-3">
          <pre className="text-xs text-foreground font-mono whitespace-pre-wrap">
            {pending.planMarkdown}
          </pre>
        </Card>
      </ScrollArea>
      <div className="flex gap-2">
        <Button onClick={() => handleRespond(true)} size="sm" variant="default">
          <Check /> Approve Plan
        </Button>
        <Button onClick={() => handleRespond(false)} size="sm" variant="destructive">
          <X /> Reject
        </Button>
      </div>
    </div>
  );
}
