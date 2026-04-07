export interface ElementContext {
  tag: string;
  id: string | null;
  text: string | null;         // trimmed textContent, max 80 chars
  aria_label: string | null;
  role: string | null;
  placeholder: string | null;
  data_testid: string | null;  // data-testid | data-cy | data-e2e, first found
  selector: string;            // best CSS selector
  xpath: string;               // absolute XPath
  classes: string[];
  bbox: { x: number; y: number; width: number; height: number };
}

export type ChromeEventType = "click" | "input" | "keydown" | "scroll" | "navigation";

export interface ChromeEvent {
  type: ChromeEventType;
  ts_ms: number;              // Date.now() - sessionStartTime
  x: number | null;
  y: number | null;
  url: string;
  page_title: string;
  element: ElementContext | null;
  input_value: string | null; // for input events: final value
  key_combo: string | null;   // for keydown: "Cmd+S", "Enter", "Tab", etc.
  scroll_dir: "up" | "down" | null;
  nav_from: string | null;
  nav_to: string | null;
}

// Message types between content script and background
export type ContentMessage =
  | { kind: "event"; event: ChromeEvent }
  | { kind: "session_start_time"; startTime: number };
