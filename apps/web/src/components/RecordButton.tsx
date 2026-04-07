import { useState, useEffect } from "react";
import { useRecorder, type RecorderMode } from "../hooks/useRecorder";
import { RecordingIndicator } from "./RecordingIndicator";

interface Props {
  cwd: string | null;
}

export function RecordButton({ cwd }: Props) {
  const { recorderState, elapsed, savedPath, startRecording, stopRecording } = useRecorder();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mode, setMode] = useState<RecorderMode>("screen");
  const [sources, setSources] = useState<{ id: string; name: string; thumbnail: string }[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Load sources whenever picker opens
  useEffect(() => {
    if (!pickerOpen) return;
    window.electronAPI.recorder.getSources().then((srcs) => {
      setSources(srcs);
      // Auto-select first screen source
      const firstScreen = srcs.find((s) => s.id.startsWith("screen:"));
      if (firstScreen && !selectedSourceId) setSelectedSourceId(firstScreen.id);
    });
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

  const handleStop = async () => {
    await stopRecording();
  };

  const sourcesForMode = mode === "window" ? windowSources : screenSources;

  if (recorderState === "recording") {
    return (
      <>
        <RecordingIndicator elapsed={elapsed} onStop={handleStop} />
        {toast && (
          <div className="fixed bottom-4 right-4 z-50 bg-[#161b22] border border-[#30363d] text-[#e6edf3] text-xs px-4 py-2 rounded-lg shadow-lg">
            {toast}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md border border-[#30363d] bg-[#21262d] text-[#e6edf3] text-xs hover:bg-[#30363d] transition-colors"
        >
          <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          Record
          <span className="ml-0.5 text-[10px] text-[#6e7681] bg-[#161b22] px-1 py-0.5 rounded font-sans">
            ⌘⇧5
          </span>
        </button>

        {pickerOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setPickerOpen(false)}
            />
            <div className="absolute right-0 top-full mt-1 w-72 bg-[#161b22] border border-[#30363d] rounded-xl p-3 shadow-2xl z-20 font-sans">
              <div className="text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">
                Chế độ
              </div>
              <div className="flex gap-1.5 mb-3">
                {(["screen", "window", "region"] as RecorderMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg border text-[11px] transition-colors ${
                      mode === m
                        ? "border-[#388bfd] bg-[#0d1117] text-[#e6edf3]"
                        : "border-[#30363d] bg-[#0d1117] text-[#6e7681] hover:text-[#c9d1d9]"
                    }`}
                  >
                    {m === "screen" ? "🖥 Toàn màn hình" : m === "window" ? "🪟 Cửa sổ" : "✂️ Vùng chọn"}
                  </button>
                ))}
              </div>

              {mode !== "region" && (
                <>
                  <div className="text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">
                    {mode === "screen" ? "Màn hình" : "Cửa sổ"}
                  </div>
                  {sourcesForMode.length === 0 ? (
                    <div className="text-[11px] text-[#6e7681] mb-3">Đang tải...</div>
                  ) : (
                    <div className="flex gap-2 flex-wrap mb-3">
                      {sourcesForMode.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setSelectedSourceId(s.id)}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            selectedSourceId === s.id
                              ? "border-[#388bfd]"
                              : "border-[#30363d] hover:border-[#6e7681]"
                          } bg-[#0d1117]`}
                        >
                          <img
                            src={s.thumbnail}
                            className="w-20 h-12 rounded object-cover mb-1"
                            alt={s.name}
                          />
                          <div className="text-[10px] text-[#8b949e] truncate max-w-[80px]">
                            {s.name}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {mode === "region" && (
                <div className="mb-3 py-3 border border-dashed border-[#30363d] rounded-lg text-center text-[#6e7681] text-xs">
                  ✂️ Kéo chọn vùng sau khi nhấn bắt đầu
                </div>
              )}

              <button
                onClick={handleStart}
                disabled={mode !== "region" && !selectedSourceId}
                className="w-full py-2 bg-[#238636] hover:bg-[#2ea043] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Bắt đầu quay ⏺
              </button>
            </div>
          </>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 bg-[#161b22] border border-[#30363d] text-[#e6edf3] text-xs px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}
    </>
  );
}
