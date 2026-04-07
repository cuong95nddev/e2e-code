import { useRef, useState, useEffect, useCallback } from "react";

interface Props {
  videoPath: string;
  dbPath: string | undefined;
  onClose: () => void;
}

const TYPE_COLOR: Record<string, string> = {
  mousedown: "#388bfd",
  mouseup:   "#1f6feb",
  keydown:   "#3fb950",
  keyup:     "#238636",
  wheel:     "#8b949e",
};

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${frac}`;
}

function formatType(type: string): string {
  const map: Record<string, string> = {
    mousedown: "click ↓",
    mouseup:   "click ↑",
    keydown:   "key ↓",
    keyup:     "key ↑",
    wheel:     "scroll",
  };
  return map[type] ?? type;
}

function describeEvent(e: ActionEvent): string {
  if (e.type === "mousedown" || e.type === "mouseup") {
    const btn = e.button === 2 ? "right" : e.button === 1 ? "mid" : "left";
    return `${btn} (${e.x}, ${e.y})`;
  }
  if (e.type === "keydown" || e.type === "keyup") {
    if (e.key_char) return `"${e.key_char}"`;
    return `keycode ${e.keycode}`;
  }
  if (e.type === "wheel") {
    return `Δ${(e.delta_y ?? 0) > 0 ? "↑" : "↓"}`;
  }
  return "";
}

export function RecordingPlayer({ videoPath, dbPath, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const handleMetadata = useCallback(async () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(d * 1000);
    if (!dbPath) return;
    const evts = await window.electronAPI.recorder.queryActions(dbPath, 0, d * 1000);
    setEvents(evts);
  }, [dbPath]);

  const handleTimeUpdate = useCallback(() => {
    const ms = (videoRef.current?.currentTime ?? 0) * 1000;
    setCurrentMs(ms);
  }, []);

  const seekTo = useCallback((ms: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ms / 1000;
  }, []);

  useEffect(() => {
    if (!listRef.current || events.length === 0) return;
    const idx = events.findIndex((e) => e.ts_ms > currentMs) - 1;
    if (idx < 0) return;
    const el = listRef.current.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [currentMs, events]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center font-sans">
      <div className="w-[90vw] max-w-5xl bg-[#0d1117] border border-[#30363d] rounded-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363d]">
          <span className="text-xs text-[#8b949e]">Recording Player</span>
          <button
            onClick={onClose}
            className="text-[#6e7681] hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Video */}
        <div className="bg-black flex-shrink-0">
          <video
            ref={videoRef}
            src={`recording://${videoPath}`}
            controls
            className="w-full max-h-[45vh] object-contain"
            onLoadedMetadata={handleMetadata}
            onTimeUpdate={handleTimeUpdate}
          />
        </div>

        {/* Timeline */}
        {duration > 0 && (
          <div className="px-4 py-2 border-t border-[#30363d] flex-shrink-0">
            <div
              className="relative h-6 bg-[#161b22] rounded cursor-crosshair"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                seekTo(ratio * duration);
              }}
            >
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-px bg-[#388bfd]"
                style={{ left: `${(currentMs / duration) * 100}%` }}
              />
              {/* Event markers */}
              {events.map((ev) => (
                <div
                  key={ev.id}
                  className="absolute top-1 w-1.5 h-1.5 rounded-full -translate-x-1/2 cursor-pointer hover:scale-150 transition-transform"
                  style={{
                    left: `${(ev.ts_ms / duration) * 100}%`,
                    backgroundColor: TYPE_COLOR[ev.type] ?? "#8b949e",
                  }}
                  onClick={(e) => { e.stopPropagation(); seekTo(ev.ts_ms); }}
                  title={`${formatMs(ev.ts_ms)} ${ev.type}`}
                />
              ))}
              {/* Time labels */}
              <div className="absolute left-0 bottom-0 text-[9px] text-[#6e7681] translate-y-full pt-0.5">0s</div>
              <div className="absolute right-0 bottom-0 text-[9px] text-[#6e7681] translate-y-full pt-0.5">
                {formatMs(duration)}
              </div>
            </div>
          </div>
        )}

        {/* Event list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-2 min-h-0"
        >
          {events.length === 0 && (
            <div className="text-xs text-[#6e7681] text-center py-4">
              {dbPath ? "No actions captured" : "No action data for this recording"}
            </div>
          )}
          {events.map((ev) => (
            <button
              key={ev.id}
              onClick={() => seekTo(ev.ts_ms)}
              className={`w-full flex items-center gap-3 px-2 py-1 rounded text-left hover:bg-[#161b22] transition-colors ${
                ev.ts_ms <= currentMs && (events[events.indexOf(ev) + 1]?.ts_ms ?? Infinity) > currentMs
                  ? "bg-[#161b22]"
                  : ""
              }`}
            >
              <span className="text-[10px] text-[#8b949e] font-mono w-16 flex-shrink-0">
                {formatMs(ev.ts_ms)}
              </span>
              <span
                className="text-[10px] w-14 flex-shrink-0 font-mono"
                style={{ color: TYPE_COLOR[ev.type] ?? "#8b949e" }}
              >
                {formatType(ev.type)}
              </span>
              <span className="text-[10px] text-[#6e7681] truncate">{describeEvent(ev)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
