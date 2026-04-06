import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useSessionStore } from "../store/sessionStore";

interface TerminalEvent {
  type: string;
  content?: string;
  toolName?: string;
  message?: string;
}

export function Terminal() {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const events = useSessionStore((s) => s.events);
  const lastWrittenRef = useRef(0);

  useEffect(() => {
    if (!termRef.current) return;
    const term = new XTerm({
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 14,
      cursorBlink: true,
      disableStdin: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);
    fitAddon.fit();
    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(termRef.current);
    xtermRef.current = term;
    return () => {
      resizeObserver.disconnect();
      term.dispose();
    };
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    for (let i = lastWrittenRef.current; i < events.length; i++) {
      const event = events[i] as TerminalEvent;
      switch (event.type) {
        case "text":
          term.write(event.content ?? "");
          break;
        case "reasoning":
          term.write(`\x1b[2m${event.content ?? ""}\x1b[0m`);
          break;
        case "toolUse":
          term.write(`\r\n\x1b[33m⚡ ${event.toolName ?? "unknown"}\x1b[0m\r\n`);
          break;
        case "toolResult":
          term.write(
            `\x1b[32m✓ ${event.toolName ?? "unknown"}\x1b[0m\r\n`,
          );
          break;
        case "error":
          term.write(
            `\r\n\x1b[31m✗ ${event.message ?? "unknown error"}\x1b[0m\r\n`,
          );
          break;
        case "turnComplete":
          term.write("\r\n\x1b[36m─── turn complete ───\x1b[0m\r\n");
          break;
      }
    }
    lastWrittenRef.current = events.length;
  }, [events]);

  return <div ref={termRef} className="flex-1 min-h-0" />;
}
