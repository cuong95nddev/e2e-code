import { useRef, useState, useEffect, useCallback } from "react";
import { AnalysisPanel } from "./AnalysisPanel";

interface Props {
  videoPath: string;
  dbPath: string | undefined;
  cwd: string | null;
  activeSessionId: string | null;
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

function filterKeyEvents(events: ActionEvent[]): ActionEvent[] {
  const result: ActionEvent[] = [];
  let lastKeydownTs = -Infinity;
  for (const e of events) {
    if (e.type === "mousedown") {
      result.push(e);
    } else if (e.type === "keydown") {
      if (e.ts_ms - lastKeydownTs > 500) {
        result.push(e);
      }
      lastKeydownTs = e.ts_ms;
    }
  }
  return result;
}

async function extractFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  tsMs: number,
): Promise<ArrayBuffer> {
  await new Promise<void>((resolve) => {
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = tsMs / 1000;
  });
  const ctx = canvas.getContext("2d")!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  return new Promise<ArrayBuffer>((resolve) => {
    canvas.toBlob((blob) => {
      blob!.arrayBuffer().then(resolve);
    }, "image/jpeg", 0.85);
  });
}

function getRichLabel(ev: ActionEvent, chromeEvents: ChromeEvent[]): string {
  // Find chrome event within ±100ms
  const ce = chromeEvents.find((c) => Math.abs(c.ts_ms - ev.ts_ms) <= 100);
  if (!ce) return describeEvent(ev);

  if (ce.type === "navigation") return `→ ${ce.nav_to ?? ce.url ?? ""}`;
  if (ce.type === "keydown" && ce.key_combo) return ce.key_combo;
  if (ce.type === "input" && ce.input_value != null) {
    const label = ce.el_aria_label ?? ce.el_placeholder ?? ce.el_tag ?? "input";
    return `"${ce.input_value}" → ${label}`;
  }
  if (ce.type === "click") {
    const label = ce.el_text ?? ce.el_aria_label ?? ce.el_testid ?? ce.el_id ?? ce.el_tag ?? "element";
    const selector = ce.el_testid ? `[data-testid="${ce.el_testid}"]` : (ce.el_id ? `#${ce.el_id}` : (ce.el_selector ?? ""));
    return `${label}${selector ? `  ${selector}` : ""}`;
  }
  return describeEvent(ev);
}

export function RecordingPlayer({ videoPath, dbPath, cwd, activeSessionId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [chromeEvents, setChromeEvents] = useState<ChromeEvent[]>([]);
  const [duration, setDuration] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Analysis panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(360);
  const [resultContent, setResultContent] = useState<string | null>(null);
  const [frames, setFrames] = useState<{ path: string; ts_ms: number }[]>([]);

  const stem = videoPath.split("/").pop()?.replace(".webm", "") ?? "recording";
  const stemDir = cwd ? `${cwd}/recordings/${stem}` : null;
  const resultPath = stemDir ? `${stemDir}/result.md` : null;
  const framesDir = stemDir ? `${stemDir}/frames` : null;

  const loadResult = useCallback(async () => {
    if (!resultPath || !framesDir) return;
    const [content, frameList] = await Promise.all([
      window.electronAPI.recorder.readFile(resultPath),
      window.electronAPI.recorder.listFrames(framesDir),
    ]);
    if (content) {
      setResultContent(content);
      setFrames(frameList);
      setPanelOpen(true);
    }
  }, [resultPath, framesDir]);

  // On mount: check if result already exists, then start watching
  useEffect(() => {
    if (!stemDir) return;
    loadResult();
    window.electronAPI.recorder.watchResult(stemDir);
    const off = window.electronAPI.recorder.onAnalysisReady(() => {
      loadResult();
    });
    return () => {
      off();
      window.electronAPI.recorder.unwatchResult(stemDir);
    };
  }, [stemDir, loadResult]);

  const handleMetadata = useCallback(async () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(d * 1000);
    if (!dbPath) return;
    const evts = await window.electronAPI.recorder.queryActions(dbPath, 0, d * 1000);
    setEvents(evts);
    const cevts = await window.electronAPI.recorder.queryChrome(dbPath, 0, d * 1000);
    setChromeEvents(cevts);
  }, [dbPath]);

  const handleTimeUpdate = useCallback(() => {
    const ms = (videoRef.current?.currentTime ?? 0) * 1000;
    setCurrentMs(ms);
  }, []);

  const seekTo = useCallback((ms: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ms / 1000;
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!cwd || !activeSessionId || !videoRef.current || !canvasRef.current) return;
    setAnalyzing(true);
    try {
      const keyEvents = filterKeyEvents(events);
      const framesDir = `${cwd}/recordings/${stem}/frames`;

      const rows: string[] = [];
      for (let i = 0; i < keyEvents.length; i++) {
        const ev = keyEvents[i]!;
        const framePath = `${framesDir}/frame-${ev.ts_ms}.jpg`;
        const buffer = await extractFrame(videoRef.current, canvasRef.current, ev.ts_ms);
        await window.electronAPI.recorder.saveFrame(framePath, buffer);

        const relFrame = `recordings/${stem}/frames/frame-${ev.ts_ms}.jpg`;
        // Try to enrich with chrome event context
        const ce = chromeEvents.find((c) => Math.abs(c.ts_ms - ev.ts_ms) <= 100);
        let detail: string;
        if (ce) {
          if (ce.type === "navigation") {
            detail = `navigation → ${ce.nav_to ?? ce.url ?? ""}`;
          } else if (ce.type === "keydown" && ce.key_combo) {
            detail = `key ${ce.key_combo}`;
          } else if (ce.type === "input" && ce.input_value != null) {
            const label = ce.el_aria_label ?? ce.el_placeholder ?? ce.el_tag ?? "input";
            detail = `typed "${ce.input_value}" in ${label} [${ce.el_selector ?? ""}]`;
          } else {
            const label = ce.el_text ?? ce.el_aria_label ?? ce.el_testid ?? ce.el_id ?? ce.el_tag ?? "element";
            const selector = ce.el_testid ? `[data-testid="${ce.el_testid}"]` : (ce.el_id ? `#${ce.el_id}` : (ce.el_selector ?? ""));
            detail = `${label}${selector ? ` [${selector}]` : ""}`;
          }
        } else {
          detail = describeEvent(ev);
        }
        rows.push(`| ${i + 1} | ${formatMs(ev.ts_ms)} | ${ev.type} | ${detail} | ${relFrame} |`);
      }

      const promptPath = `${cwd}/recordings/${stem}/analyze.md`;
      const content = [
        `# Recording Analysis Task`,
        ``,
        `## Your job`,
        `Invoke the /analyze-recording skill to analyze this recording.`,
        ``,
        `## Frames directory`,
        `recordings/${stem}/frames/`,
        ``,
        `## Action Events`,
        `| # | Time | Type | Detail | Frame |`,
        `|---|------|------|--------|-------|`,
        ...rows,
      ].join("\n");

      await window.electronAPI.recorder.writeFile(promptPath, content);

      const relPrompt = `recordings/${stem}/analyze.md`;
      window.electronAPI.pty.write(activeSessionId, `/analyze-recording ${relPrompt}\n`);
    } finally {
      setAnalyzing(false);
    }
  }, [cwd, activeSessionId, events, chromeEvents, stem]);

  useEffect(() => {
    if (!listRef.current || events.length === 0) return;
    const idx = events.findIndex((e) => e.ts_ms > currentMs) - 1;
    if (idx < 0) return;
    const el = listRef.current.children[idx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [currentMs, events]);

  return (
    <div className="flex h-full font-sans bg-[#0d1117] overflow-hidden">
      {/* Left: video + timeline + events */}
      <div className="flex flex-col flex-1 min-w-0">
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
          {events.length > 0 && (
            <div className="flex items-center justify-end gap-2 px-3 py-1.5">
              <button
                onClick={handleAnalyze}
                disabled={analyzing || !cwd || !activeSessionId}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-[#30363d] bg-[#21262d] text-[#e6edf3] text-xs hover:bg-[#30363d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {analyzing ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <span className="text-[#3fb950]">✦</span>
                    Analyze with Claude
                  </>
                )}
              </button>
            </div>
          )}
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

        {/* Hidden canvas for frame extraction */}
        <canvas ref={canvasRef} className="hidden" />

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
          {events.map((ev, i) => (
            <button
              key={ev.id}
              onClick={() => seekTo(ev.ts_ms)}
              className={`w-full flex items-center gap-3 px-2 py-1 rounded text-left hover:bg-[#161b22] transition-colors ${
                ev.ts_ms <= currentMs && (events[i + 1]?.ts_ms ?? Infinity) > currentMs
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
              <span className="text-[10px] text-[#6e7681] truncate">{getRichLabel(ev, chromeEvents)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Right: Analysis panel */}
      {panelOpen && resultContent && (
        <AnalysisPanel
          resultContent={resultContent}
          frames={frames}
          events={events}
          currentMs={currentMs}
          width={panelWidth}
          onClose={() => setPanelOpen(false)}
          onWidthChange={setPanelWidth}
          onSeek={seekTo}
        />
      )}
    </div>
  );
}
