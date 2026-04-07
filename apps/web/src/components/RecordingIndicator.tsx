import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";

interface Props {
  elapsed: number;
  onStop: () => void;
}

export function RecordingIndicator({ elapsed, onStop }: Props) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-md border border-destructive/40 bg-destructive/10">
      <span className="w-2 h-2 rounded-full bg-destructive animate-pulse flex-shrink-0" />
      <span className="font-mono text-xs text-destructive-foreground tabular-nums">
        {mm}:{ss}
      </span>
      <Separator orientation="vertical" className="h-3.5 bg-destructive/30" />
      <Button variant="ghost" size="sm" onClick={onStop}>
        Stop
      </Button>
    </div>
  );
}
