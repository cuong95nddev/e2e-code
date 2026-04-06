import { useState, useCallback, type KeyboardEvent } from "react";
import { Send, Square } from "lucide-react";
import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";

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
    if (!sessionId || state === "idle" || state === "stopped") {
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
    <div className="border-t border-gray-800 p-3 flex gap-2 items-end">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          isRunning ? "Claude is thinking..." : "Send a message..."
        }
        className="flex-1 bg-gray-900 text-white border border-gray-700 rounded-lg px-4 py-2 resize-none focus:outline-none focus:border-blue-500 font-mono text-sm"
        rows={1}
        disabled={
          state === "awaitingApproval" || state === "awaitingPlanReview"
        }
      />
      {isRunning ? (
        <button
          onClick={handleStop}
          className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white"
          title="Stop"
        >
          <Square size={18} />
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="p-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          title="Send"
        >
          <Send size={18} />
        </button>
      )}
    </div>
  );
}
