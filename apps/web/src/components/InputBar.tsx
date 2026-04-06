import { useState, useCallback, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

export function InputBar() {
  const [input, setInput] = useState("");
  const state = useSessionStore((s) => s.state);
  const sessionId = useSessionStore((s) => s.sessionId);
  const model = useSessionStore((s) => s.model);
  const permissionMode = useSessionStore((s) => s.permissionMode);
  const cwd = useSessionStore((s) => s.cwd);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!sessionId || state === "stopped") {
      transport.send("startSession", {
        cwd,
        model,
        permissionMode,
        prompt: trimmed,
      });
    } else {
      transport.send("sendTurn", { sessionId, prompt: trimmed });
    }
    setInput("");
  }, [input, sessionId, state, model, permissionMode, cwd]);

  const handleStop = useCallback(() => {
    if (sessionId) transport.send("stopSession", { sessionId });
  }, [sessionId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const isRunning = state === "running";

  return (
    <div className="border-t border-border p-3 flex gap-2 items-end bg-card">
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isRunning ? "Claude is thinking..." : "Send a message..."
        }
        className="flex-1 resize-none text-sm font-mono min-h-9"
        rows={1}
        disabled={
          state === "awaitingApproval" || state === "awaitingPlanReview"
        }
      />
      {isRunning ? (
        <Button
          onClick={handleStop}
          variant="destructive"
          size="icon"
          title="Stop"
        >
          <Square />
        </Button>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={!input.trim()}
          size="icon"
          title="Send"
        >
          <Send />
        </Button>
      )}
    </div>
  );
}
