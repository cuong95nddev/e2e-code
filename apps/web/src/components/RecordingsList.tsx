import { useState, useEffect } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

interface Props {
  cwd: string | null;
  refreshKey: number;
  selectedPath: string | null;
  onSelect: (r: RecordingMeta | null) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatName(name: string): string {
  return name.replace(".webm", "").replace("_", " ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");
}

export function RecordingsList({ cwd, refreshKey, selectedPath, onSelect }: Props) {
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);

  useEffect(() => {
    if (!cwd) { setRecordings([]); return; }
    window.electronAPI.recorder.listFiles(cwd).then(setRecordings);
  }, [cwd, refreshKey]);

  if (recordings.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col min-h-0 font-sans">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
          Recordings
        </span>
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
          {recordings.length}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 pr-1">
          {recordings.map((r) => (
            <button
              key={r.path}
              onClick={() => onSelect(selectedPath === r.path ? null : r)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors text-xs",
                selectedPath === r.path
                  ? "border-primary bg-background text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-border/70 hover:text-card-foreground"
              )}
            >
              <span className="text-sm">🎬</span>
              <span className="flex-1 font-mono truncate">{formatName(r.name)}</span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {formatSize(r.size)}
              </span>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
