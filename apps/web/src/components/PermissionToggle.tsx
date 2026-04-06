import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Shield, ShieldCheck, ShieldOff } from "lucide-react";

const MODES = [
  { id: "default", label: "Default", Icon: Shield },
  { id: "plan", label: "Plan", Icon: ShieldCheck },
  { id: "fullAccess", label: "Full Access", Icon: ShieldOff },
];

export function PermissionToggle() {
  const mode = useSessionStore((s) => s.permissionMode);
  const sessionId = useSessionStore((s) => s.sessionId);

  const handleChange = (newMode: string) => {
    useSessionStore.getState().setPermissionMode(newMode);
    if (sessionId) {
      transport.send("setPermissionMode", { sessionId, permissionMode: newMode });
    }
  };

  const current = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const Icon = current!.Icon;

  return (
    <div className="flex items-center gap-1">
      <Icon size={14} className="text-gray-500" />
      <select
        value={mode}
        onChange={(e) => handleChange(e.target.value)}
        className="bg-gray-900 text-gray-300 border border-gray-700 rounded px-2 py-1 text-xs font-mono"
      >
        {MODES.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </div>
  );
}
