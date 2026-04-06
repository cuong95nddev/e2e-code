import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Check, X, Zap } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";

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
    <div className="border-t border-warning/32 bg-warning/4 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="size-4 text-warning" />
        <span className="text-sm font-medium text-warning-foreground">
          Tool approval
        </span>
        <Badge variant="warning" size="sm">{pending.toolName}</Badge>
      </div>
      <Card className="mb-3 p-2 overflow-auto max-h-32">
        <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
          {JSON.stringify(pending.toolInput, null, 2)}
        </pre>
      </Card>
      <div className="flex gap-2">
        <Button onClick={() => handleRespond(true)} size="sm" variant="default">
          <Check /> Allow
        </Button>
        <Button onClick={() => handleRespond(false)} size="sm" variant="destructive">
          <X /> Deny
        </Button>
      </div>
    </div>
  );
}
