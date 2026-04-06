import { useSessionStore } from "../store/sessionStore";
import { transport } from "../rpc/wsTransport";
import { Shield, ShieldCheck, ShieldOff } from "lucide-react";
import { Select, SelectPopup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";

const MODES = [
  { id: "default", label: "Default", Icon: Shield },
  { id: "plan", label: "Plan", Icon: ShieldCheck },
  { id: "fullAccess", label: "Full Access", Icon: ShieldOff },
];

export function PermissionToggle() {
  const mode = useSessionStore((s) => s.permissionMode);
  const sessionId = useSessionStore((s) => s.sessionId);

  const handleChange = (newMode: string | null) => {
    if (!newMode) return;
    useSessionStore.getState().setPermissionMode(newMode);
    if (sessionId) {
      transport.send("setPermissionMode", { sessionId, permissionMode: newMode });
    }
  };

  const current = MODES.find((m) => m.id === mode) ?? MODES[0]!;
  const Icon = current!.Icon;

  return (
    <Select value={mode} onValueChange={handleChange}>
      <SelectTrigger size="sm" variant="ghost" className="w-auto gap-1.5 font-mono text-xs">
        <Icon className="size-3.5" />
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {MODES.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <m.Icon className="size-3.5" />
            {m.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
