import { useState, useEffect } from "react";
import { Video } from "lucide-react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

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
        <span className="text-xs text-muted-foreground uppercase tracking-widest">
          Recordings
        </span>
        <Badge variant="secondary">{recordings.length}</Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 pr-1">
          {recordings.map((r) => (
            <Button
              key={r.path}
              variant={selectedPath === r.path ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onSelect(selectedPath === r.path ? null : r)}
              className="w-full justify-start gap-2 font-normal"
            >
              <Video className="size-3 shrink-0 text-muted-foreground" />
              <span className="flex-1 font-mono truncate text-left">{formatName(r.name)}</span>
              <span className="text-xs text-muted-foreground shrink-0">{formatSize(r.size)}</span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
