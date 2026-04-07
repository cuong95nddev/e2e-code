import { useRef, useCallback, useEffect } from "react";

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
  frameNames: string[]; // e.g. ["frame-5007.jpg", "frame-5207.jpg"]
  text: string;         // description after the frame prefix
}

function parseSteps(content: string): ParsedStep[] {
  const steps: ParsedStep[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\d+\. (.*)$/);
    if (!match) continue;
    const body = match[1]!;
    // Extract leading backtick-quoted frame names: `frame-XXXX.jpg`, `frame-YYYY.jpg` — rest
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

  // Build filename → step text lookup
  const stepByFrame = new Map<string, string>();
  for (const step of steps) {
    for (const name of step.frameNames) {
      stepByFrame.set(name, step.text);
    }
  }

  // Active step: last frame whose ts_ms <= currentMs
  const activeIdx = (() => {
    let idx = -1;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i]!.ts_ms <= currentMs) idx = i;
    }
    return idx;
  })();

  // Auto-scroll active step into view
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
      className="flex flex-col h-full bg-[#0d1117] border-l border-[#30363d] relative flex-shrink-0"
      style={{ width }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[#388bfd] transition-colors z-10"
        onMouseDown={handleResizeMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#30363d] flex-shrink-0">
        <span className="text-xs font-semibold text-[#e6edf3]">Analysis</span>
        <button
          onClick={onClose}
          className="text-[#6e7681] hover:text-[#e6edf3] transition-colors text-sm leading-none"
        >
          ×
        </button>
      </div>

      {/* Unified step list */}
      <div ref={listRef} className="flex-1 overflow-y-auto min-h-0 p-2 space-y-2">
        {frames.length === 0 && (
          <div className="flex items-center justify-center h-32 text-xs text-[#6e7681]">
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
              className={`w-full text-left rounded-md border overflow-hidden transition-colors group ${
                isActive
                  ? "border-[#388bfd] bg-[#0d2137]"
                  : "border-[#30363d] hover:border-[#388bfd]"
              }`}
            >
              <img
                src={`recording://${frame.path}`}
                alt={`Frame at ${formatMs(frame.ts_ms)}`}
                className="w-full object-contain bg-black"
                loading="lazy"
              />
              <div className="px-2 py-1.5 bg-[#161b22] flex items-start gap-2">
                <span
                  className={`text-[10px] font-mono flex-shrink-0 mt-0.5 ${
                    isActive ? "text-[#388bfd]" : "text-[#6e7681]"
                  }`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="flex-1 min-w-0">
                  {stepText ? (
                    <span
                      className={`text-[11px] leading-snug ${
                        isActive ? "text-[#e6edf3]" : "text-[#c9d1d9]"
                      }`}
                    >
                      {stepText.trim()}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#6e7681] font-mono">
                      {formatMs(frame.ts_ms)}
                    </span>
                  )}
                </span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#388bfd] flex-shrink-0 mt-1 animate-pulse" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
