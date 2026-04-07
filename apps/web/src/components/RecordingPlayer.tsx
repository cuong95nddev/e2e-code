import { useRef, useState, useEffect, useCallback } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Camera, MousePointerClick, Keyboard, ArrowUpDown, Navigation2, type LucideIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { cn } from "~/lib/utils";

interface Props {
  videoPath: string;
  dbPath: string | undefined;
  cwd: string | null;
  activeSessionId: string | null;
  onShowTerminal?: () => void;
}

const TYPE_ICON: Record<string, LucideIcon> = {
  mousedown:  MousePointerClick,
  mouseup:    MousePointerClick,
  click:      MousePointerClick,
  keydown:    Keyboard,
  keyup:      Keyboard,
  input:      Keyboard,
  wheel:      ArrowUpDown,
  scroll:     ArrowUpDown,
  navigation: Navigation2,
};

const TYPE_COLOR: Record<string, string> = {
  mousedown: "var(--primary)",
  mouseup:   "var(--primary)",
  keydown:   "var(--chart-2)",
  keyup:     "var(--chart-2)",
  wheel:     "var(--muted-foreground)",
  click:     "var(--primary)",
  input:     "var(--chart-2)",
  navigation: "var(--chart-4)",
  scroll:    "var(--muted-foreground)",
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
    mousedown:  "click ↓",
    mouseup:    "click ↑",
    keydown:    "key ↓",
    keyup:      "key ↑",
    wheel:      "scroll",
    click:      "click",
    input:      "input",
    navigation: "nav",
    scroll:     "scroll",
  };
  return map[type] ?? type;
}

function describeChromeEvent(e: ChromeEvent): string {
  if (e.type === "navigation") return `→ ${e.nav_to ?? e.url ?? ""}`;
  if (e.type === "keydown" && e.key_combo) return e.key_combo;
  if (e.type === "input" && e.input_value != null) {
    const label = e.el_aria_label ?? e.el_placeholder ?? e.el_tag ?? "input";
    return `"${e.input_value}" → ${label}`;
  }
  if (e.type === "click") {
    const label = e.el_text ?? e.el_aria_label ?? e.el_testid ?? e.el_id ?? e.el_tag ?? "element";
    const selector = e.el_testid ? `[data-testid="${e.el_testid}"]` : (e.el_id ? `#${e.el_id}` : (e.el_selector ?? ""));
    return `${label}${selector ? `  ${selector}` : ""}`;
  }
  return e.type;
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
      if (e.ts_ms - lastKeydownTs > 500) result.push(e);
      lastKeydownTs = e.ts_ms;
    }
  }
  return result;
}

async function extractFrame(
  src: string,
  canvas: HTMLCanvasElement,
  tsMs: number,
): Promise<ArrayBuffer> {
  const video = document.createElement("video");
  video.src = src;
  video.muted = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video load error"));
    video.load();
  });
  await new Promise<void>((resolve) => {
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = tsMs / 1000;
  });
  const ctx = canvas.getContext("2d")!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);
  video.src = "";
  return new Promise<ArrayBuffer>((resolve) => {
    canvas.toBlob((blob) => blob!.arrayBuffer().then(resolve), "image/jpeg", 0.85);
  });
}

function getRichLabel(ev: ActionEvent, chromeEvents: ChromeEvent[]): string {
  const ce = chromeEvents.find((c) => Math.abs(c.ts_ms - ev.ts_ms) <= 100);
  if (!ce) return describeEvent(ev);
  return describeChromeEvent(ce);
}

export function RecordingPlayer({ videoPath, dbPath, cwd, activeSessionId, onShowTerminal }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [videoServerPort, setVideoServerPort] = useState(0);

  useEffect(() => {
    window.electronAPI.app.getVideoServerPort().then(setVideoServerPort);
  }, []);

  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [events, setEvents] = useState<ActionEvent[]>([]);
  const [chromeEvents, setChromeEvents] = useState<ChromeEvent[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [resultContent, setResultContent] = useState<string | null>(null);
  const [frames, setFrames] = useState<{ path: string; ts_ms: number }[]>([]);
  const [eventsDialogOpen, setEventsDialogOpen] = useState(false);

  useEffect(() => {
    setPaused(true);
    setCurrentMs(0);
    setDuration(0);
    setEvents([]);
    setChromeEvents([]);
    setResultContent(null);
    setFrames([]);
  }, [videoPath]);

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
    }
  }, [resultPath, framesDir]);

  useEffect(() => {
    if (!stemDir) return;
    loadResult();
    window.electronAPI.recorder.watchResult(stemDir);
    const off = window.electronAPI.recorder.onAnalysisReady(() => loadResult());
    return () => { off(); window.electronAPI.recorder.unwatchResult(stemDir); };
  }, [stemDir, loadResult]);

  const handleMetadata = useCallback(async () => {
    const d = videoRef.current?.duration ?? 0;
    setDuration(isFinite(d) && d > 0 ? d * 1000 : 0);
    if (!dbPath) return;
    const [evts, cevts] = await Promise.all([
      window.electronAPI.recorder.queryActions(dbPath, 0, d * 1000),
      window.electronAPI.recorder.queryChrome(dbPath, 0, d * 1000),
    ]);
    setEvents(evts);
    setChromeEvents(cevts);
  }, [dbPath]);

  const handleTimeUpdate = useCallback(() => {
    setCurrentMs((videoRef.current?.currentTime ?? 0) * 1000);
  }, []);

  const seekTo = useCallback((ms: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = ms / 1000;
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen();
  }, []);

  const useChrome = events.length === 0 && chromeEvents.length > 0;
  const displayEvents = useChrome ? chromeEvents : events;
  const effectiveDuration = duration > 0 ? duration : (displayEvents.at(-1)?.ts_ms ?? 0);

  const currentSubtitle = (() => {
    if (!resultContent || frames.length === 0) return null;
    const stepByFrame = new Map<string, string>();
    for (const line of resultContent.split("\n")) {
      const match = line.match(/^\d+\. (.*)$/);
      if (!match) continue;
      const body = match[1]!;
      const frameMatch = body.match(/^((?:`frame-[^`]+\.jpg`(?:,\s*)?)+)\s*[—-]\s*(.*)$/);
      if (frameMatch) {
        const names = [...frameMatch[1]!.matchAll(/`(frame-[^`]+\.jpg)`/g)].map((m) => m[1]!);
        for (const name of names) stepByFrame.set(name, frameMatch[2]!);
      }
    }
    const activeFrame = frames.findLast((f) => f.ts_ms <= currentMs);
    if (!activeFrame) return null;
    return stepByFrame.get(activeFrame.path.split("/").pop() ?? "") ?? null;
  })();

  const handleAnalyze = useCallback(async () => {
    if (!cwd || !activeSessionId || !canvasRef.current || !videoServerPort) return;
    setAnalyzing(true);
    const src = `http://127.0.0.1:${videoServerPort}${videoPath}`;
    try {
      const framesDirPath = `${cwd}/recordings/${stem}/frames`;
      type FrameRow = { relPath: string; time: string };
      const frameRows: FrameRow[] = [];
      const seenFrames = new Set<string>();
      type EventRow = { num: number; time: string; frame: string; cols: string[] };
      const eventRows: EventRow[] = [];

      const cell = (v: string | number | null | undefined) =>
        v == null || v === "" ? "" : String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");

      const saveFrameFor = async (ts_ms: number): Promise<string> => {
        const framePath = `${framesDirPath}/frame-${ts_ms}.jpg`;
        const relPath = `recordings/${stem}/frames/frame-${ts_ms}.jpg`;
        if (!seenFrames.has(relPath)) {
          const buffer = await extractFrame(src, canvasRef.current!, ts_ms);
          await window.electronAPI.recorder.saveFrame(framePath, buffer);
          seenFrames.add(relPath);
          frameRows.push({ relPath, time: formatMs(ts_ms) });
        }
        return relPath;
      };

      if (useChrome) {
        for (let i = 0; i < chromeEvents.length; i++) {
          const ce = chromeEvents[i]!;
          const frame = await saveFrameFor(ce.ts_ms);
          eventRows.push({
            num: i + 1, time: formatMs(ce.ts_ms), frame,
            cols: [
              cell(ce.type), cell(ce.url), cell(ce.page_title), cell(ce.el_tag),
              cell(ce.el_id), cell(ce.el_text), cell(ce.el_aria_label), cell(ce.el_role),
              cell(ce.el_placeholder), cell(ce.el_testid), cell(ce.el_selector),
              cell(ce.input_value), ce.x != null ? `(${ce.x},${ce.y})` : "",
            ],
          });
        }
      } else {
        const keyEvents = filterKeyEvents(events);
        for (let i = 0; i < keyEvents.length; i++) {
          const ev = keyEvents[i]!;
          const frame = await saveFrameFor(ev.ts_ms);
          eventRows.push({
            num: i + 1, time: formatMs(ev.ts_ms), frame,
            cols: [
              cell(ev.type), ev.x != null ? `(${ev.x},${ev.y})` : "",
              cell(ev.button), cell(ev.keycode), cell(ev.key_char),
              cell(ev.modifiers), ev.delta_y != null ? `${ev.delta_x},${ev.delta_y}` : "",
            ],
          });
        }
      }

      const eventCols = useChrome
        ? ["Type", "URL", "Page Title", "Tag", "ID", "Text", "Aria Label", "Role", "Placeholder", "Test ID", "Selector", "Input Value", "Position"]
        : ["Type", "Position", "Button", "Keycode", "Key", "Modifiers", "Delta"];

      const content = [
        `# Recording Analysis Task`,
        ``,
        `## Your job`,
        `Invoke the /analyze-recording skill to analyze this recording.`,
        ``,
        `## Frames`,
        `| Frame | Time |`,
        `|-------|------|`,
        ...frameRows.map((r) => `| ${r.relPath} | ${r.time} |`),
        ``,
        `## Action Events`,
        `| # | Time | Frame | ${eventCols.join(" | ")} |`,
        `|---|------|-------|${eventCols.map(() => "------").join("|")}|`,
        ...eventRows.map((r) => `| ${r.num} | ${r.time} | ${r.frame} | ${r.cols.join(" | ")} |`),
      ].join("\n");

      const promptPath = `${cwd}/recordings/${stem}/analyze.md`;
      await window.electronAPI.recorder.writeFile(promptPath, content);
      onShowTerminal?.();
      window.electronAPI.pty.write(activeSessionId, `/analyze-recording recordings/${stem}/analyze.md\r`);
    } finally {
      setAnalyzing(false);
    }
  }, [cwd, activeSessionId, events, chromeEvents, useChrome, stem, videoPath]);

  return (
    <div className="flex h-full font-sans bg-background overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">

        {/* Video */}
        <div ref={containerRef} className="bg-black flex-1 min-h-0 relative">
          <video
            ref={videoRef}
            src={videoServerPort > 0 ? `http://127.0.0.1:${videoServerPort}${videoPath}` : undefined}
            className="w-full h-full object-contain block"
            onLoadedMetadata={handleMetadata}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setPaused(false)}
            onPause={() => setPaused(true)}
            onEnded={() => setPaused(true)}
          />

          {/* Subtitle */}
          {currentSubtitle && (
            <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none px-4">
              <div className="bg-black/70 text-white text-xs px-3 py-1.5 rounded max-w-[80%] text-center leading-snug">
                {currentSubtitle}
              </div>
            </div>
          )}
        </div>

        {/* Controls bar */}
        <div className="flex items-center gap-2 px-4 py-2 bg-background shrink-0 border-t">
          <Button variant="ghost" size="icon" onClick={togglePlay} title={paused ? "Play" : "Pause"}>
            {paused ? <Play /> : <Pause />}
          </Button>

          <span className="text-xs text-muted-foreground font-mono tabular-nums select-none">
            {formatMs(currentMs)} / {formatMs(effectiveDuration)}
          </span>

          <div className="flex-1" />

          <Button variant="ghost" size="icon" onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX /> : <Volume2 />}
          </Button>

          <Button variant="ghost" size="icon" onClick={toggleFullscreen} title="Fullscreen">
            <Maximize />
          </Button>

          {displayEvents.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setEventsDialogOpen(true)}>
              Events
            </Button>
          )}

          {displayEvents.length > 0 && (
            <Button variant="secondary" size="sm" onClick={handleAnalyze} disabled={analyzing || !cwd || !activeSessionId}>
              {analyzing && <span className="size-1.5 rounded-full bg-chart-4 animate-pulse" />}
              {analyzing ? "Analyzing…" : "Analyze with Claude"}
            </Button>
          )}
        </div>

        {/* Timeline */}
        {effectiveDuration > 0 && (
          <div className="px-4 pt-2 pb-1 border-t border-border flex-shrink-0 space-y-1">
            {/* Events row */}
            <div
              className="relative h-5 bg-card rounded cursor-crosshair overflow-hidden"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                seekTo(((e.clientX - rect.left) / rect.width) * effectiveDuration);
              }}
            >
              <div
                className="absolute top-0 bottom-0 w-px bg-primary"
                style={{ left: `${(currentMs / effectiveDuration) * 100}%` }}
              />
              {displayEvents.map((ev) => {
                const Icon = TYPE_ICON[ev.type];
                return (
                  <div
                    key={ev.id}
                    className="absolute -translate-x-1/2 cursor-pointer hover:scale-125 transition-transform"
                    style={{ left: `${(ev.ts_ms / effectiveDuration) * 100}%`, top: "2px", color: TYPE_COLOR[ev.type] ?? "var(--muted-foreground)" }}
                    onClick={(e) => { e.stopPropagation(); seekTo(ev.ts_ms); }}
                    title={`${formatMs(ev.ts_ms)} ${ev.type}`}
                  >
                    {Icon
                      ? <Icon className="size-3" />
                      : <span className="block w-1.5 h-1.5 rounded-full bg-current" />}
                  </div>
                );
              })}
            </div>

            {/* Analysis result row */}
            {frames.length > 0 && (() => {
              const stepByFrame = new Map<string, string>();
              if (resultContent) {
                for (const line of resultContent.split("\n")) {
                  const match = line.match(/^\d+\. (.*)$/);
                  if (!match) continue;
                  const body = match[1]!;
                  const fm = body.match(/^((?:`frame-[^`]+\.jpg`(?:,\s*)?)+)\s*[—-]\s*(.*)$/);
                  if (fm) {
                    for (const [, name] of [...fm[1]!.matchAll(/`(frame-[^`]+\.jpg)`/g)]) {
                      stepByFrame.set(name!, fm[2]!);
                    }
                  }
                }
              }
              return (
                <div
                  className="relative h-5 bg-card rounded cursor-crosshair overflow-hidden"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    seekTo(((e.clientX - rect.left) / rect.width) * effectiveDuration);
                  }}
                >
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary"
                    style={{ left: `${(currentMs / effectiveDuration) * 100}%` }}
                  />
                  {frames.map((f) => {
                    const name = f.path.split("/").pop() ?? "";
                    const label = stepByFrame.get(name);
                    const isActive = frames.findLast((fr) => fr.ts_ms <= currentMs)?.ts_ms === f.ts_ms;
                    return (
                      <div
                        key={f.ts_ms}
                        className="absolute -translate-x-1/2 cursor-pointer hover:scale-125 transition-transform"
                        style={{ left: `${(f.ts_ms / effectiveDuration) * 100}%`, top: "2px" }}
                        onClick={(e) => { e.stopPropagation(); seekTo(f.ts_ms); }}
                        title={label ? `${formatMs(f.ts_ms)} — ${label}` : formatMs(f.ts_ms)}
                      >
                        <Camera
                          className={cn("size-3", isActive ? "text-chart-4" : "text-muted-foreground")}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div className="flex justify-between">
              <span className="text-xs text-muted-foreground">0s</span>
              <span className="text-xs text-muted-foreground">{formatMs(effectiveDuration)}</span>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Events dialog */}
      <Dialog open={eventsDialogOpen} onOpenChange={setEventsDialogOpen}>
        <DialogContent className="w-[560px] max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-4 py-3 border-b border-border flex-shrink-0">
            <DialogTitle className="text-xs font-semibold">
              Events ({displayEvents.length})
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1">
            <div className="px-3 py-2">
              {displayEvents.map((ev, i) => (
                <button
                  key={ev.id}
                  onClick={() => { seekTo(ev.ts_ms); setEventsDialogOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-2 py-1 rounded text-left hover:bg-accent transition-colors",
                    ev.ts_ms <= currentMs && (displayEvents[i + 1]?.ts_ms ?? Infinity) > currentMs
                      ? "bg-accent"
                      : ""
                  )}
                >
                  <span className="text-xs text-muted-foreground font-mono w-16 flex-shrink-0">
                    {formatMs(ev.ts_ms)}
                  </span>
                  <span
                    className="text-xs w-14 flex-shrink-0 font-mono"
                    style={{ color: TYPE_COLOR[ev.type] ?? "var(--muted-foreground)" }}
                  >
                    {formatType(ev.type)}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {useChrome
                      ? describeChromeEvent(ev as ChromeEvent)
                      : getRichLabel(ev as ActionEvent, chromeEvents)}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
