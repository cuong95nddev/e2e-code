import { useState, useEffect } from "react";
import { RecordingPlayer } from "./RecordingPlayer";

interface Props {
  cwd: string | null;
  refreshKey: number;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
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
  const [playerRecording, setPlayerRecording] = useState<RecordingMeta | null>(null);

  useEffect(() => {
    if (!cwd) { setRecordings([]); return; }
    window.electronAPI.recorder.listFiles(cwd).then(setRecordings);
  }, [cwd, refreshKey]);

  if (recordings.length === 0) return null;

  return (
    <>
      <div className="mt-3 font-sans flex flex-col min-h-0">
        <div className="text-[10px] text-[#6e7681] uppercase tracking-widest mb-2">
          Recordings ({recordings.length})
        </div>

        <div className="flex flex-col gap-1 overflow-y-auto">
          {recordings.map((r) => (
            <div
              key={r.path}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors flex-shrink-0 ${
                selectedPath === r.path
                  ? "border-[#388bfd] bg-[#0d1117] text-[#e6edf3]"
                  : "border-[#30363d] bg-[#161b22] text-[#8b949e] hover:border-[#6e7681] hover:text-[#c9d1d9]"
              }`}
            >
              <button
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                onClick={() => onSelect(selectedPath === r.path ? null : r.path)}
              >
                <span className="text-sm">🎬</span>
                <span className="flex-1 text-xs font-mono truncate">{formatName(r.name)}</span>
                <span className="text-[10px] text-[#6e7681] flex-shrink-0">{formatSize(r.size)}</span>
              </button>
              <button
                onClick={() => setPlayerRecording(r)}
                className="flex-shrink-0 px-2 py-0.5 text-[10px] rounded border border-[#30363d] hover:border-[#388bfd] hover:text-[#388bfd] transition-colors"
                title="Open player with action timeline"
              >
                ▶
              </button>
            </div>
          ))}
        </div>
      </div>

      {playerRecording && (
        <RecordingPlayer
          videoPath={playerRecording.path}
          dbPath={playerRecording.dbPath}
          onClose={() => setPlayerRecording(null)}
        />
      )}
    </>
  );
}
