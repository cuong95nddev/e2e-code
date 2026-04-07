import type { ChromeEvent, ElementContext } from "./types";


// ---- Re-injection guard ----

declare global { interface Window { __e2eRecorder?: { stop: () => void } } }
if (window.__e2eRecorder) window.__e2eRecorder.stop();
window.__e2eRecorder = { stop: () => { active = false; } };

// ---- State ----

let active = false;
let sessionId: string | null = null;
let sessionStartTime: number | null = null;
let recordedEvents: ChromeEvent[] = [];

// ---- Message listener (chrome API — guarded) ----

function isContextValid(): boolean {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

if (isContextValid()) {
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.name === "startEvents") {
        active = true;
        sessionId = msg.sessionId;
        sessionStartTime = msg.startTime;
        recordedEvents = [];
        sendResponse({ ok: true });
        return;
      }
      if (msg.name === "stopEvents") {
        active = false;
        flushEvents(sessionId);
        sendResponse({ ok: true });
        return;
      }
    });
  } catch { /* context invalidated during setup */ }
}

// ---- Flush ----

function flushEvents(sid: string | null): void {
  if (!sid || recordedEvents.length === 0) return;
  const events = recordedEvents;
  recordedEvents = [];
  // Send to background service worker — survives page refresh
  try {
    chrome.runtime.sendMessage({ name: "recordEvents", events }).catch(() => {});
  } catch { /* context invalidated */ }
}

// Flush on page unload — use sendBeacon for reliable delivery before page dies
window.addEventListener("beforeunload", () => {
  if (!active || recordedEvents.length === 0 || !sessionId) return;
  const events = recordedEvents;
  recordedEvents = [];
  // sendBeacon is fire-and-forget and guaranteed to complete even during unload
  try {
    navigator.sendBeacon(
      "http://localhost:7878/events",
      JSON.stringify({ sessionId, events }),
    );
  } catch {
    // Fallback to async message if beacon fails (e.g., not supported)
    flushEvents(sessionId);
  }
});

// ---- Helpers ----

function tsMs(): number {
  return sessionStartTime === null ? 0 : Date.now() - sessionStartTime;
}

function send(event: ChromeEvent): void {
  if (active) recordedEvents.push(event);
}

// Duck-type guard: handles cross-realm, SVG, shadow DOM, YouTube custom elements
function isElement(el: unknown): el is Element {
  return !!el && typeof (el as Element).getAttribute === "function";
}

// ---- Element context ----

const EMPTY_CTX: ElementContext = {
  tag: "unknown", id: null, text: null, aria_label: null, role: null,
  placeholder: null, data_testid: null, selector: "", xpath: "", classes: [],
  bbox: { x: 0, y: 0, width: 0, height: 0 },
};

function getBestSelector(el: Element): string {
  if (!isElement(el)) return "";
  const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-cy") ?? el.getAttribute("data-e2e");
  if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;
  const id = el.id;
  if (id && !/^\d/.test(id) && !id.includes(":")) return `#${CSS.escape(id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id && !/^\d/.test(node.id)) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    const siblings = Array.from(node.parentElement?.children ?? []).filter(s => s.tagName === node!.tagName);
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
    node = node.parentElement;
    if (parts.length >= 2 && document.querySelectorAll(parts.join(" > ")).length === 1) break;
  }
  return parts.join(" > ");
}

function getXPath(el: Element): string {
  if (!isElement(el)) return "";
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    const siblings = Array.from(node.parentElement?.children ?? []).filter(s => s.tagName === node!.tagName);
    const idx = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : "";
    parts.unshift(`${tag}${idx}`);
    node = node.parentElement;
  }
  return `//${parts.join("/")}`;
}

function getImplicitRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const map: Record<string, string> = {
    button: "button", a: "link", input: "textbox",
    select: "listbox", textarea: "textbox", nav: "navigation",
    main: "main", header: "banner", footer: "contentinfo",
  };
  if (tag === "input") {
    const type = (el as HTMLInputElement).type;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
  }
  return map[tag] ?? null;
}

function getElementContext(el: unknown): ElementContext {
  if (!isElement(el)) return EMPTY_CTX;
  let bbox = { x: 0, y: 0, width: 0, height: 0 };
  try {
    const r = el.getBoundingClientRect();
    bbox = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  } catch { /* detached */ }
  const tag = el.tagName?.toLowerCase() ?? "unknown";
  const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-cy") ?? el.getAttribute("data-e2e") ?? null;
  const rawText = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? null;
  const classes = Array.from(el.classList).filter(
    (c) => !/^(css-|sc-|_|tw-|bg-|text-|px-|py-|mx-|my-|flex|grid|w-|h-|rounded|border|hover:|focus:)/.test(c),
  ).slice(0, 5);
  return {
    tag,
    id: el.id || null,
    text: rawText || null,
    aria_label: el.getAttribute("aria-label"),
    role: el.getAttribute("role") ?? getImplicitRole(el),
    placeholder: (el as HTMLInputElement).placeholder || null,
    data_testid: testid,
    selector: getBestSelector(el),
    xpath: getXPath(el),
    classes,
    bbox,
  };
}

// ---- DOM event listeners ----

document.addEventListener("mousedown", (e) => {
  const target = e.target;
  if (!isElement(target) || target === document.body || target === document.documentElement) return;
  let el: Element | null = target;
  while (el && el !== document.body) {
    const tag = el.tagName.toLowerCase();
    if (["a", "button", "input", "select", "textarea", "label", "tr", "td", "li"].includes(tag)) break;
    if (isElement(el) && (el.getAttribute("role") || el.getAttribute("aria-label") || el.getAttribute("data-testid"))) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) el = target;
  send({
    type: "click", ts_ms: tsMs(),
    x: Math.round(e.clientX), y: Math.round(e.clientY),
    url: location.href, page_title: document.title,
    element: getElementContext(el),
    input_value: null, key_combo: null, scroll_dir: null, nav_from: null, nav_to: null,
  });
}, { capture: true, passive: true });

const inputTimers = new WeakMap<EventTarget, ReturnType<typeof setTimeout>>();
document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  const prev = inputTimers.get(target);
  if (prev) clearTimeout(prev);
  inputTimers.set(target, setTimeout(() => {
    send({
      type: "input", ts_ms: tsMs(),
      x: null, y: null,
      url: location.href, page_title: document.title,
      element: getElementContext(target),
      input_value: target.value ?? null,
      key_combo: null, scroll_dir: null, nav_from: null, nav_to: null,
    });
  }, 400));
}, { capture: true, passive: true });

document.addEventListener("keydown", (e) => {
  const isShortcut = e.metaKey || e.ctrlKey || e.altKey;
  const isSpecial = ["Enter", "Escape", "Tab", "Backspace", "Delete",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
  if (!isShortcut && !isSpecial) return;
  const parts: string[] = [];
  if (e.metaKey) parts.push("Cmd");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  send({
    type: "keydown", ts_ms: tsMs(),
    x: null, y: null,
    url: location.href, page_title: document.title,
    element: getElementContext(e.target),
    input_value: null, key_combo: parts.join("+"),
    scroll_dir: null, nav_from: null, nav_to: null,
  });
}, { capture: true, passive: true });

let lastScrollTime = 0;
document.addEventListener("scroll", (e) => {
  const now = Date.now();
  if (now - lastScrollTime < 200) return;
  lastScrollTime = now;
  const target = e.target;
  const scrollTop = isElement(target) ? (target as Element & { scrollTop?: number }).scrollTop ?? 0 : window.scrollY;
  send({
    type: "scroll", ts_ms: tsMs(),
    x: null, y: null,
    url: location.href, page_title: document.title,
    element: isElement(target) && target !== document.body ? getElementContext(target) : null,
    input_value: null, key_combo: null,
    scroll_dir: scrollTop > 0 ? "down" : "up",
    nav_from: null, nav_to: null,
  });
}, { capture: true, passive: true });

const _origPush = history.pushState.bind(history);
history.pushState = function (...args) {
  const from = location.href;
  _origPush(...args);
  send({
    type: "navigation", ts_ms: tsMs(),
    x: null, y: null,
    url: location.href, page_title: document.title,
    element: null, input_value: null, key_combo: null, scroll_dir: null,
    nav_from: from, nav_to: location.href,
  });
};

window.addEventListener("popstate", () => {
  send({
    type: "navigation", ts_ms: tsMs(),
    x: null, y: null,
    url: location.href, page_title: document.title,
    element: null, input_value: null, key_combo: null, scroll_dir: null,
    nav_from: null, nav_to: location.href,
  });
});
