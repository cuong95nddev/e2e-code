import { useState, useEffect, useCallback, useRef } from "react";
import { Terminal } from "./components/Terminal";
import { RecordingsList } from "./components/RecordingsList";
import { RecordingPlayer } from "./components/RecordingPlayer";

interface Session {
  id: string;
  cwd: string;
  cliSessionId: string | null;
  isResume: boolean;
  exited: boolean;
  exitCode: number | null;
}

let nextId = 1;
function generateSessionId(): string {
  return `session-${nextId++}-${Date.now()}`;
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [recordingRefreshKey, setRecordingRefreshKey] = useState(0);
  const [selectedRecording, setSelectedRecording] = useState<RecordingMeta | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(300);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [leftWidth, setLeftWidth] = useState(288);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const isLeftDragging = useRef(false);
  const leftDragStartX = useRef(0);
  const leftDragStartWidth = useRef(0);

  const createSession = useCallback(async (cwd?: string) => {
    const lastFolder = localStorage.getItem("lastFolder") ?? undefined;
    const folder = cwd ?? lastFolder ?? (await window.electronAPI.app.pickFolder());
    if (!folder) return;
    localStorage.setItem("lastFolder", folder);

    const id = generateSessionId();
    const session: Session = {
      id,
      cwd: folder,
      cliSessionId: null,
      isResume: false,
      exited: false,
      exitCode: null,
    };

    setSessions((prev) => [...prev, session]);
    setActiveSessionId(id);

    // Spawn PTY after state update
    requestAnimationFrame(() => {
      window.electronAPI.pty.create(id, folder, null, false);
    });
  }, []);

  const closeSession = useCallback((id: string) => {
    window.electronAPI.pty.kill(id);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      return next;
    });
    setActiveSessionId((current) => {
      if (current !== id) return current;
      const remaining = sessions.filter((s) => s.id !== id);
      const last = remaining[remaining.length - 1];
      return last ? last.id : null;
    });
  }, [sessions]);

  const restartSession = useCallback((id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, exited: false, exitCode: null } : s)),
    );
    window.electronAPI.pty.create(id, session.cwd, null, false);
  }, [sessions]);

  // Drag-to-resize handlers
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const delta = dragStartY.current - e.clientY;
        const newHeight = Math.max(150, Math.min(dragStartHeight.current + delta, window.innerHeight * 0.8));
        setTerminalHeight(newHeight);
      }
      if (isLeftDragging.current) {
        const delta = e.clientX - leftDragStartX.current;
        const newWidth = Math.max(160, Math.min(leftDragStartWidth.current + delta, window.innerWidth * 0.5));
        setLeftWidth(newWidth);
      }
    };
    const onMouseUp = () => { isDragging.current = false; isLeftDragging.current = false; };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;
    e.preventDefault();
  };

  const handleLeftDragStart = (e: React.MouseEvent) => {
    isLeftDragging.current = true;
    leftDragStartX.current = e.clientX;
    leftDragStartWidth.current = leftWidth;
    e.preventDefault();
  };

  // Keep chrome-bridge cwd in sync with active session so recordings land in the right folder
  useEffect(() => {
    const cwd = sessions.find((s) => s.id === activeSessionId)?.cwd;
    if (cwd) window.electronAPI.chrome.setActiveCwd(cwd);
  }, [activeSessionId, sessions]);

  // Listen for file list changes (e.g. new recording saved by chrome extension)
  useEffect(() => {
    const off = window.electronAPI.recorder.onFileListChanged(() => {
      setRecordingRefreshKey((k) => k + 1);
    });
    return off;
  }, []);

  // Listen for PTY exit events
  useEffect(() => {
    const unsubExit = window.electronAPI.pty.onExit((sessionId, exitCode) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, exited: true, exitCode } : s,
        ),
      );
    });
    return unsubExit;
  }, []);

  // Create first session on mount if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      createSession();
    }
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const folderName = (cwd: string) => cwd.split("/").pop() ?? cwd;

  return (
    <div className="h-screen flex flex-col bg-[#0d1117] text-[#e6edf3]">
      {/* Tab bar */}
      <div
        className="flex items-center h-10 bg-[#010409] border-b border-[#30363d] select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* macOS traffic light spacing */}
        <div className="w-20 flex-shrink-0" />

        <div className="flex-1" />
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Top content — two columns */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left: actions + recordings list */}
          <div className="flex-shrink-0 flex flex-col border-r border-[#30363d] p-3 overflow-y-auto" style={{ width: leftWidth }}>
            <RecordingsList
              cwd={activeSession?.cwd ?? null}
              refreshKey={recordingRefreshKey}
              selectedPath={selectedRecording?.path ?? null}
              onSelect={setSelectedRecording}
            />
            {sessions.length === 0 && (
              <div className="flex items-center justify-center flex-1">
                <button
                  onClick={() => createSession()}
                  className="px-6 py-3 bg-[#238636] text-white rounded-md hover:bg-[#2ea043]"
                >
                  Open Project Folder
                </button>
              </div>
            )}
          </div>

          {/* Left/Right resize handle */}
          <div
            className="w-1 flex-shrink-0 bg-[#30363d] hover:bg-[#388bfd] cursor-col-resize transition-colors"
            onMouseDown={handleLeftDragStart}
          />

          {/* Right: video player */}
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden">
            {selectedRecording ? (
              <RecordingPlayer
                key={selectedRecording.path}
                videoPath={selectedRecording.path}
                dbPath={selectedRecording.dbPath}
                cwd={activeSession?.cwd ?? null}
                activeSessionId={activeSessionId}
              />
            ) : (
              <div className="flex items-center justify-center h-full bg-black">
                <span className="text-[#3d444d] text-sm font-sans select-none">
                  Chọn một recording để xem
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Terminal panel */}
        {terminalVisible ? (
          <>
            <div
              className="h-1 bg-[#30363d] hover:bg-[#388bfd] cursor-ns-resize transition-colors flex-shrink-0"
              onMouseDown={handleDragStart}
            />
            <div className="flex items-center h-8 bg-[#010409] border-t border-[#30363d] flex-shrink-0 px-2 gap-1">
              <span className="text-[10px] text-[#6e7681] uppercase tracking-widest font-sans px-1">
                Terminal
              </span>
              <div className="flex items-center gap-0.5 flex-1 overflow-x-auto">
                {sessions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    className={`
                      flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono whitespace-nowrap max-w-[160px]
                      transition-colors
                      ${s.id === activeSessionId ? "bg-[#161b22] text-[#e6edf3]" : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9]"}
                      ${s.exited ? "opacity-60" : ""}
                    `}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.exited ? "bg-red-500" : "bg-green-500"}`} />
                    <span className="truncate">{folderName(s.cwd)}</span>
                    <span onClick={(e) => { e.stopPropagation(); closeSession(s.id); }} className="ml-0.5 text-[#8b949e] hover:text-white cursor-pointer">×</span>
                  </button>
                ))}
                <button onClick={() => createSession()} className="px-1.5 py-0.5 text-[#8b949e] hover:text-white text-sm leading-none">+</button>
              </div>
              <button onClick={() => setTerminalVisible(false)} className="text-[#6e7681] hover:text-white text-sm leading-none flex-shrink-0">×</button>
            </div>
            <div className="relative flex-shrink-0" style={{ height: terminalHeight }}>
              {sessions.map((s) => (
                <div key={s.id} className={`absolute inset-0 ${s.id === activeSessionId ? "" : "hidden"}`}>
                  <Terminal sessionId={s.id} visible={s.id === activeSessionId} />
                  {s.exited && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                      <div className="text-center">
                        <p className="text-[#8b949e] mb-3">Process exited (code: {s.exitCode})</p>
                        <button onClick={() => restartSession(s.id)} className="px-4 py-2 bg-[#238636] text-white rounded-md text-sm hover:bg-[#2ea043]">Restart</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex items-center h-7 bg-[#010409] border-t border-[#30363d] px-3 flex-shrink-0">
            <button onClick={() => setTerminalVisible(true)} className="text-[10px] text-[#6e7681] uppercase tracking-widest hover:text-white font-sans transition-colors">
              Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
