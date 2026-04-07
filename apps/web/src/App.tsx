import { useState, useEffect, useCallback } from "react";
import { Terminal } from "./components/Terminal";

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

  const createSession = useCallback(async (cwd?: string) => {
    const folder = cwd ?? (await window.electronAPI.app.pickFolder());
    if (!folder) return;

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
      <div className="flex items-center h-10 bg-[#010409] border-b border-[#30363d] select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* macOS traffic light spacing */}
        <div className="w-20 flex-shrink-0" />

        <div className="flex items-center gap-0.5 overflow-x-auto flex-1 px-1"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-mono
                transition-colors whitespace-nowrap max-w-[200px]
                ${s.id === activeSessionId
                  ? "bg-[#161b22] text-[#e6edf3]"
                  : "text-[#8b949e] hover:bg-[#161b22] hover:text-[#c9d1d9]"
                }
                ${s.exited ? "opacity-60" : ""}
              `}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                s.exited ? "bg-red-500" : "bg-green-500"
              }`} />
              <span className="truncate">{folderName(s.cwd)}</span>
              <span
                onClick={(e) => { e.stopPropagation(); closeSession(s.id); }}
                className="ml-1 text-[#8b949e] hover:text-white cursor-pointer"
              >
                x
              </span>
            </button>
          ))}

          <button
            onClick={() => createSession()}
            className="px-2 py-1.5 text-[#8b949e] hover:text-white text-sm"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            +
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div className="flex-1 min-h-0 relative">
        {sessions.map((s) => (
          <div key={s.id} className={`absolute inset-0 ${s.id === activeSessionId ? "" : "hidden"}`}>
            <Terminal
              sessionId={s.id}
              visible={s.id === activeSessionId}
            />
            {s.exited && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                <div className="text-center">
                  <p className="text-[#8b949e] mb-3">
                    Process exited (code: {s.exitCode})
                  </p>
                  <button
                    onClick={() => restartSession(s.id)}
                    className="px-4 py-2 bg-[#238636] text-white rounded-md text-sm hover:bg-[#2ea043]"
                  >
                    Restart
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {sessions.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <button
              onClick={() => createSession()}
              className="px-6 py-3 bg-[#238636] text-white rounded-md hover:bg-[#2ea043]"
            >
              Open Project Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
