import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

interface TerminalProps {
  sessionId: string;
  visible: boolean;
}

export function Terminal({ sessionId, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#0d1117",
        red: "#e94560",
        green: "#0f9b58",
        yellow: "#f4b400",
        blue: "#4285f4",
        magenta: "#ab47bc",
        cyan: "#00acc1",
        white: "#e6edf3",
      },
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // User keystrokes → PTY
    term.onData((data) => {
      window.electronAPI.pty.write(sessionId, data);
    });

    // Shift+Enter → CSI u encoding for Claude CLI newline
    containerRef.current.addEventListener("keydown", (e) => {
      if (e.shiftKey && e.key === "Enter") {
        window.electronAPI.pty.write(sessionId, "\x1b[13;2u");
        e.preventDefault();
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        const { cols, rows } = term;
        window.electronAPI.pty.resize(sessionId, cols, rows);
      } catch {
        // not visible yet
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  // PTY data → terminal
  useEffect(() => {
    const unsubData = window.electronAPI.pty.onData((sid, data) => {
      if (sid === sessionId && xtermRef.current) {
        xtermRef.current.write(data);
      }
    });
    return unsubData;
  }, [sessionId]);

  // Fit when visibility changes
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
          if (xtermRef.current) {
            const { cols, rows } = xtermRef.current;
            window.electronAPI.pty.resize(sessionId, cols, rows);
          }
        } catch {
          // ignore
        }
      });
      xtermRef.current?.focus();
    }
  }, [visible, sessionId]);

  // Spawn PTY once mounted
  useEffect(() => {
    if (!spawnedRef.current) {
      spawnedRef.current = true;
      // sessionId doubles as cwd for now — App passes cwd as the session's cwd
      // The actual spawn is triggered by the parent via onSpawn
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
