interface Props {
  elapsed: number;
  onStop: () => void;
}

export function RecordingIndicator({ elapsed, onStop }: Props) {
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-2 px-3 py-1 border border-[#3d1a1a] bg-[#1a0a0a] rounded-md">
      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
      <span className="font-mono text-xs text-red-300 tabular-nums">{mm}:{ss}</span>
      <div className="w-px h-3.5 bg-[#3d1a1a]" />
      <button
        onClick={onStop}
        className="text-xs text-[#8b949e] hover:text-white px-1.5 py-0.5 border border-[#30363d] rounded transition-colors"
      >
        Stop
      </button>
    </div>
  );
}
