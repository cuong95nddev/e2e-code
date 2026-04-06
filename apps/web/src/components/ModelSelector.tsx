import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Select, SelectPopup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export function ModelSelector() {
  const model = useSessionStore((s) => s.model);
  const sessionId = useSessionStore((s) => s.sessionId);

  const handleChange = (newModel: string | null) => {
    if (!newModel) return;
    useSessionStore.getState().setModel(newModel);
    if (sessionId) transport.send("setModel", { sessionId, model: newModel });
  };

  return (
    <Select value={model} onValueChange={handleChange}>
      <SelectTrigger size="sm" className="w-32 font-mono text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
