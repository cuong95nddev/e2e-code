import type { ChromeEvent, ElementContext, ContentMessage } from "./types";

let sessionStartTime: number | null = null;

// Receive start time from background when session begins
chrome.runtime.onMessage.addListener((msg: ContentMessage) => {
  if (msg.kind === "session_start_time") {
    sessionStartTime = msg.startTime;
  }
});

function tsMs(): number {
  if (sessionStartTime === null) return 0;
  return Date.now() - sessionStartTime;
}

function send(event: ChromeEvent): void {
  chrome.runtime.sendMessage({ kind: "event", event } satisfies ContentMessage);
}

// --- Element context extraction ---

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

function getBestSelector(el: Element): string {
  // Priority: data-testid → aria-label → id → role+text → CSS
  const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-cy") ?? el.getAttribute("data-e2e");
  if (testid) return `[data-testid="${CSS.escape(testid)}"]`;

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return `[aria-label="${CSS.escape(ariaLabel)}"]`;

  const id = el.id;
  if (id && !/^\d/.test(id) && !id.includes(":")) return `#${CSS.escape(id)}`;

  // Walk up DOM to find shortest unique CSS selector
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id && !/^\d/.test(node.id)) {
      part = `#${CSS.escape(node.id)}`;
      parts.unshift(part);
      break;
    }
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (s) => s.tagName === node!.tagName,
    );
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
    // Stop if already unique
    if (parts.length >= 2 && document.querySelectorAll(parts.join(" > ")).length === 1) break;
  }
  return parts.join(" > ");
}

function getXPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase();
    const siblings = Array.from(node.parentElement?.children ?? []).filter(
      (s) => s.tagName === node!.tagName,
    );
    const idx = siblings.length > 1 ? `[${siblings.indexOf(node) + 1}]` : "";
    parts.unshift(`${tag}${idx}`);
    node = node.parentElement;
  }
  return `//${parts.join("/")}`;
}

function getElementContext(el: Element): ElementContext {
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();

  const testid =
    el.getAttribute("data-testid") ??
    el.getAttribute("data-cy") ??
    el.getAttribute("data-e2e") ??
    null;

  // Get meaningful text: prefer aria-label, then textContent (trimmed, max 80)
  const rawText = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) ?? null;

  // Filter out utility/generated class names
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
    bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

// --- Event listeners ---

document.addEventListener("mousedown", (e) => {
  const target = e.target as Element | null;
  if (!target || target === document.body || target === document.documentElement) return;

  // Walk up to find meaningful interactive element
  let el: Element | null = target;
  while (el && el !== document.body) {
    const tag = el.tagName.toLowerCase();
    if (["a", "button", "input", "select", "textarea", "label", "tr", "td", "li"].includes(tag)) break;
    if (el.getAttribute("role") || el.getAttribute("aria-label") || el.getAttribute("data-testid")) break;
    if (el.getAttribute("onclick") !== null) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) el = target;

  send({
    type: "click",
    ts_ms: tsMs(),
    x: Math.round(e.clientX),
    y: Math.round(e.clientY),
    url: location.href,
    page_title: document.title,
    element: getElementContext(el),
    input_value: null,
    key_combo: null,
    scroll_dir: null,
    nav_from: null,
    nav_to: null,
  });
}, { capture: true, passive: true });

// Input: debounced, capture final value
const inputTimers = new WeakMap<EventTarget, ReturnType<typeof setTimeout>>();
document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  const existing = inputTimers.get(target);
  if (existing) clearTimeout(existing);
  inputTimers.set(target, setTimeout(() => {
    send({
      type: "input",
      ts_ms: tsMs(),
      x: null, y: null,
      url: location.href,
      page_title: document.title,
      element: getElementContext(target),
      input_value: target.value ?? null,
      key_combo: null,
      scroll_dir: null,
      nav_from: null,
      nav_to: null,
    });
  }, 400));
}, { capture: true, passive: true });

// Keydown: shortcuts only (Cmd+, Ctrl+, special keys)
document.addEventListener("keydown", (e) => {
  const isShortcut = e.metaKey || e.ctrlKey || e.altKey;
  const isSpecial = ["Enter", "Escape", "Tab", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F1", "F2", "F3", "F4", "F5"].includes(e.key);
  if (!isShortcut && !isSpecial) return;

  const parts: string[] = [];
  if (e.metaKey)  parts.push("Cmd");
  if (e.ctrlKey)  parts.push("Ctrl");
  if (e.altKey)   parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const combo = parts.join("+");

  const target = e.target as Element | null;
  send({
    type: "keydown",
    ts_ms: tsMs(),
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: target && target !== document.body ? getElementContext(target) : null,
    input_value: null,
    key_combo: combo,
    scroll_dir: null,
    nav_from: null,
    nav_to: null,
  });
}, { capture: true, passive: true });

// Scroll: throttled, 200ms
let lastScrollTime = 0;
document.addEventListener("scroll", (e) => {
  const now = Date.now();
  if (now - lastScrollTime < 200) return;
  lastScrollTime = now;
  const currentTsMs = tsMs();

  const target = e.target as Element | null;
  const deltaY = target ? (target as Element & { scrollTop?: number }).scrollTop ?? 0 : window.scrollY;
  send({
    type: "scroll",
    ts_ms: currentTsMs,
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: target && target !== document.body ? getElementContext(target as Element) : null,
    input_value: null,
    key_combo: null,
    scroll_dir: deltaY > 0 ? "down" : "up",
    nav_from: null,
    nav_to: null,
  });
}, { capture: true, passive: true });

// Navigation: hook pushState + popstate
const originalPushState = history.pushState.bind(history);
history.pushState = function (...args) {
  const from = location.href;
  originalPushState(...args);
  send({
    type: "navigation",
    ts_ms: tsMs(),
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: null,
    input_value: null,
    key_combo: null,
    scroll_dir: null,
    nav_from: from,
    nav_to: location.href,
  });
};

window.addEventListener("popstate", () => {
  send({
    type: "navigation",
    ts_ms: tsMs(),
    x: null, y: null,
    url: location.href,
    page_title: document.title,
    element: null,
    input_value: null,
    key_combo: null,
    scroll_dir: null,
    nav_from: null,
    nav_to: location.href,
  });
});
