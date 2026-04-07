export {};

const BRIDGE_URL = "http://localhost:7878";

const btn = document.getElementById("btn") as HTMLButtonElement;
const connDot = document.getElementById("conn-dot") as HTMLDivElement;
const connLabel = document.getElementById("conn-label") as HTMLSpanElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;

let recording = false;
let timerInterval: ReturnType<typeof setInterval> | null = null;

function formatTime(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function startTimer(startTime: number) {
  timerEl.style.display = "block";
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = `● ${formatTime(elapsed)}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerEl.style.display = "none";
}

function setUI(state: "idle" | "recording" | "busy" | "disconnected") {
  btn.disabled = state === "busy" || state === "disconnected";
  if (state === "idle") {
    btn.textContent = "Start Recording"; btn.className = "start";
    connDot.className = "dot connected"; connLabel.textContent = "Connected to e2e-code";
    stopTimer();
  } else if (state === "recording") {
    btn.textContent = "Stop Recording"; btn.className = "stop";
    connDot.className = "dot recording"; connLabel.textContent = "Recording…";
  } else if (state === "busy") {
    btn.textContent = btn.textContent; btn.className = "";
    connDot.className = "dot"; connLabel.textContent = "Working…";
  } else {
    btn.textContent = "Start Recording"; btn.className = "start";
    connDot.className = "dot"; connLabel.textContent = "e2e-code app not running";
    stopTimer();
  }
}

async function init() {
  try {
    const r = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw new Error();
  } catch {
    setUI("disconnected");
    return;
  }

  const s = await chrome.storage.session.get(["recording", "startTime"]);
  recording = (s["recording"] as boolean) ?? false;
  if (recording) {
    setUI("recording");
    startTimer((s["startTime"] as number) ?? Date.now());
  } else {
    setUI("idle");
  }
}

async function startRecording() {
  setUI("busy");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { connLabel.textContent = "No active tab"; setUI("idle"); return; }

  // tabCapture must be called from popup (requires user gesture context)
  let streamId: string;
  try {
    streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => {
        if (chrome.runtime.lastError || !id) reject(chrome.runtime.lastError ?? new Error("no streamId"));
        else resolve(id);
      });
    });
  } catch (e) {
    connLabel.textContent = `tabCapture failed: ${e}`; btn.disabled = false; return;
  }

  // Create session on bridge
  let sessionId: string; let startTime: number;
  try {
    const res = await fetch(`${BRIDGE_URL}/session/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), signal: AbortSignal.timeout(5000),
    });
    ({ sessionId, startTime } = await res.json() as { sessionId: string; startTime: number });
  } catch { connLabel.textContent = "Bridge error"; btn.disabled = false; return; }

  // Hand off to background to orchestrate recording tab + content script
  const result = await chrome.runtime.sendMessage({
    name: "startRecording",
    body: { streamId, sessionId, startTime, targetTabId: tab.id },
  }) as { ok: boolean; error?: string };

  if (!result?.ok) { connLabel.textContent = result?.error ?? "Start failed"; btn.disabled = false; return; }

  recording = true;
  setUI("recording");
  startTimer(startTime);
}

async function stopRecording() {
  setUI("busy");
  await chrome.runtime.sendMessage({ name: "stopRecording" });
  recording = false;
  stopTimer();
  connLabel.textContent = "Saved — check e2e-code app";
  setUI("idle");
}

btn.addEventListener("click", () => {
  if (!recording) startRecording();
  else stopRecording();
});

init();
