import { useRef, useCallback, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

interface Props {
  resultContent: string;
  frames: FrameEntry[];
  events: ActionEvent[];
  currentMs: number;
  width: number;
  onClose: () => void;
  onWidthChange: (w: number) => void;
  onSeek: (ms: number) => void;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${frac}`;
}

interface ParsedStep {
  frameNames: string[];
  text: string;
}

function parseSteps(content: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\d+\. (.*)$/);
    if (!match) continue;
    const body = match[1]!;
    const frameMatch = body.match(/^((?:`frame-[^`]+\.jpg`(?:,\s*)?)+)\s*[—-]\s*(.*)$/);
    if (frameMatch) {
      const frameNames = [...frameMatch[1]!.matchAll(/`(frame-[^`]+\.jpg)`/g)].map((m) => m[1]!);
      steps.push({ frameNames, text: frameMatch[2]! });
    } else {
      steps.push({ frameNames: [], text: body });
    }
  }
  return steps;
}

export function AnalysisPanel({
  resultContent,
  frames,
  events: _events,
  currentMs,
  width,
  onClose,
  onWidthChange,
  onSeek,
}: Props) {
  const resizing = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const steps = parseSteps(resultContent);

  const stepByFrame = new Map<string, string>();
  for (const step of steps) {
    for (const name of step.frameNames) {
      stepByFrame.set(name, step.text);
    }
  }

  const activeIdx = (() => {
    let idx = -1;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i]!.ts_ms <= currentMs) idx = i;
    }
    return idx;
  })();

  useEffect(() => {
    if (!listRef.current || activeIdx < 0) return;
    const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const diff = startX - ev.clientX;
        const newWidth = Math.min(Math.max(startWidth + diff, 240), 700);
        onWidthChange(newWidth);
      };

      const onMouseUp = () => {
        resizing.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width, onWidthChange],
  );

  return (
    <div
      className="flex flex-col h-full bg-background border-l border-border relative flex-shrink-0"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-10"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs font-semibold text-foreground">Analysis</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-auto w-auto p-0.5 text-muted-foreground hover:text-foreground"
        >
          ×
        </Button>
      </div>

      {/* Step list */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={listRef} className="p-2 space-y-2">
          {frames.length === 0 && (
            <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
              No frames extracted yet
            </div>
          )}
          {frames.map((frame, i) => {
            const isActive = i === activeIdx;
            const frameName = frame.path.split("/").pop() ?? "";
            const stepText = stepByFrame.get(frameName);
            return (
              <button
                key={frame.ts_ms}
                onClick={() => onSeek(frame.ts_ms)}
                className={cn(
                  "w-full text-left rounded-md border overflow-hidden transition-colors group",
                  isActive
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                )}
              >
                <img
                  src={`recording://${frame.path}`}
                  alt={`Frame at ${formatMs(frame.ts_ms)}`}
                  className="w-full object-contain bg-black"
                  loading="lazy"
                />
                <div className="px-2 py-1.5 bg-card flex items-start gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-mono flex-shrink-0 mt-0.5",
                      isActive ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 min-w-0">
                    {stepText ? (
                      <span
                        className={cn(
                          "text-[11px] leading-snug",
                          isActive ? "text-foreground" : "text-card-foreground"
                        )}
                      >
                        {stepText.trim()}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatMs(frame.ts_ms)}
                      </span>
                    )}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 mt-1 animate-pulse" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
