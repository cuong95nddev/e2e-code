import { useEffect, useRef } from "react";
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
  const prevVisibleRef = useRef(visible);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: {
        background: "#09090b",    // zinc-950
        foreground: "#fafafa",    // zinc-50
        cursor: "#a1a1aa",        // zinc-400
        selectionBackground: "#3f3f46", // zinc-700
        black: "#18181b",
        red: "#e94560",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#fafafa",
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
      // Only steal focus when transitioning from hidden → visible
      if (!prevVisibleRef.current) {
        xtermRef.current?.focus();
      }
    }
    prevVisibleRef.current = visible;
  }, [visible, sessionId]);

  useEffect(() => {
    if (!spawnedRef.current) {
      spawnedRef.current = true;
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-background"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
