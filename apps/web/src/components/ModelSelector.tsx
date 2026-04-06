import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export function ModelSelector() {
  const model = useSessionStore((s) => s.model);
  const sessionId = useSessionStore((s) => s.sessionId);

  const handleChange = (newModel: string) => {
    useSessionStore.getState().setModel(newModel);
    if (sessionId) transport.send("setModel", { sessionId, model: newModel });
  };

  return (
    <select
      value={model}
      onChange={(e) => handleChange(e.target.value)}
      className="bg-gray-900 text-gray-300 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
    >
      {MODELS.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
