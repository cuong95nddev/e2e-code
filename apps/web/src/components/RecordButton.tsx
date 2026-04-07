import { useState, useEffect } from "react";
import { Monitor, AppWindow, Scissors } from "lucide-react";
import { useRecorder, type RecorderMode } from "../hooks/useRecorder";
import { RecordingIndicator } from "./RecordingIndicator";
import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";

interface Props {
  cwd: string | null;
  onSaved?: (path: string) => void;
}

export function RecordButton({ cwd, onSaved }: Props) {
  const { recorderState, elapsed, savedPath, startRecording, stopRecording } = useRecorder();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<RecorderMode>("screen");
  const [sources, setSources] = useState<{ id: string; name: string; thumbnail: string }[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Load sources whenever picker opens
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    window.electronAPI.recorder.getSources().then((srcs) => {
      if (cancelled) return;
      setSources(srcs);
      const firstScreen = srcs.find((s) => s.id.startsWith("screen:"));
      if (firstScreen) {
        setSelectedSourceId((current) => current ?? firstScreen.id);
      }
    });
    return () => { cancelled = true; };
  }, [pickerOpen]);

  // Reset source selection when mode changes
  useEffect(() => {
    setSelectedSourceId(null);
  }, [mode]);

  // Listen for global shortcut
  useEffect(() => {
    return window.electronAPI.recorder.onTogglePicker(() => {
      setPickerOpen((v) => !v);
    });
  }, []);

  // Show toast when a recording is saved
  useEffect(() => {
    if (!savedPath) return;
    const fileName = savedPath.split("/").pop() ?? savedPath;
    setToast(`Saved: recordings/${fileName}`);
    onSaved?.(savedPath);
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [savedPath]);

  const screenSources = sources.filter((s) => s.id.startsWith("screen:"));
  const windowSources = sources.filter((s) => !s.id.startsWith("screen:"));

  const handleStart = async () => {
    if (!cwd) return;

    let sourceId = selectedSourceId;
    let cropRegion: { x: number; y: number; width: number; height: number } | undefined;

    if (mode === "region") {
      const screenId = selectedSourceId ?? screenSources[0]?.id;
      if (!screenId) return;
      setPickerOpen(false);
      const region = await window.electronAPI.recorder.openOverlay(screenId);
      if (!region) return;
      sourceId = screenId;
      cropRegion = region;
    } else {
      if (!sourceId) return;
      setPickerOpen(false);
    }

    await startRecording({ sourceId: sourceId!, mode, ...(cropRegion ? { cropRegion } : {}), cwd });
  };

  const sourcesForMode = mode === "window" ? windowSources : screenSources;

  if (recorderState === "recording") {
    return (
      <>
        <RecordingIndicator elapsed={elapsed} onStop={stopRecording} />
        {toast && (
          <div className="fixed bottom-4 right-4 z-50 bg-card border border-border text-card-foreground text-xs px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        {/* PopoverTrigger (base-nova) renders its own element; render trigger content inline */}
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <span className="size-2 rounded-full bg-destructive flex-shrink-0" />
            Record
            <Badge variant="secondary">⌘⇧5</Badge>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 font-sans" align="start">
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2">
            Chế độ
          </div>
          <Tabs value={mode} onValueChange={(v) => setMode(v as RecorderMode)} className="mb-3">
            <TabsList className="w-full">
              <TabsTrigger value="screen" className="flex-1"><Monitor className="size-4" /> Toàn màn hình</TabsTrigger>
              <TabsTrigger value="window" className="flex-1"><AppWindow className="size-4" /> Cửa sổ</TabsTrigger>
              <TabsTrigger value="region" className="flex-1"><Scissors className="size-4" /> Vùng chọn</TabsTrigger>
            </TabsList>
          </Tabs>

          {mode !== "region" && (
            <>
              <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2">
                {mode === "screen" ? "Màn hình" : "Cửa sổ"}
              </div>
              {sourcesForMode.length === 0 ? (
                <div className="text-xs text-muted-foreground mb-3">Đang tải...</div>
              ) : (
                <div className="flex gap-2 flex-wrap mb-3">
                  {sourcesForMode.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSourceId(s.id)}
                      className={cn(
                        "p-1.5 rounded-lg border transition-colors bg-background",
                        selectedSourceId === s.id
                          ? "border-primary"
                          : "border-border hover:border-border/70"
                      )}
                    >
                      <img
                        src={s.thumbnail}
                        className="w-20 h-12 rounded object-cover mb-1"
                        alt={s.name}
                      />
                      <div className="text-xs text-muted-foreground truncate max-w-[80px]">
                        {s.name}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {mode === "region" && (
            <div className="mb-3 py-3 border border-dashed rounded-lg text-center text-muted-foreground text-xs">
              Kéo chọn vùng sau khi nhấn bắt đầu
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleStart}
            disabled={mode !== "region" && !selectedSourceId}
          >
            Bắt đầu quay
          </Button>
        </PopoverContent>
      </Popover>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-card border border-border text-card-foreground text-xs px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
