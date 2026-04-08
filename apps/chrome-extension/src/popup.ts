export {};

const BRIDGE_URL = "http://localhost:7878";

const btnTab  = document.getElementById("btn-tab")  as HTMLButtonElement;
const btnPick = document.getElementById("btn-pick") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnsEl  = document.getElementById("btns")     as HTMLDivElement;
const connDot   = document.getElementById("conn-dot")   as HTMLDivElement;
const connLabel = document.getElementById("conn-label") as HTMLSpanElement;
const timerEl   = document.getElementById("timer")      as HTMLDivElement;

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
  const isRecording = state === "recording";
  const isBusy      = state === "busy";
  const isDisconn   = state === "disconnected";

  btnsEl.style.display  = isRecording ? "none" : "";
  btnStop.style.display = isRecording ? "" : "none";

  btnTab.disabled  = isBusy || isDisconn || isRecording;
  btnPick.disabled = isBusy || isDisconn || isRecording;
  btnStop.disabled = isBusy;

  if (state === "idle") {
    connDot.className = "dot connected"; connLabel.textContent = "Connected to e2e-code";
    stopTimer();
  } else if (state === "recording") {
    connDot.className = "dot recording"; connLabel.textContent = "Recording…";
  } else if (state === "busy") {
    connDot.className = "dot"; connLabel.textContent = "Working…";
  } else {
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

async function createSession(): Promise<{ sessionId: string; startTime: number } | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/session/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}), signal: AbortSignal.timeout(5000),
    });
    return await res.json() as { sessionId: string; startTime: number };
  } catch {
    connLabel.textContent = "Bridge error";
    return null;
  }
}

// Record current tab — recording tab calls tabCapture.getMediaStreamId itself to avoid expiry
async function startTabRecording() {
  setUI("busy");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { connLabel.textContent = "No active tab"; setUI("idle"); return; }

  const session = await createSession();
  if (!session) { setUI("idle"); return; }
  const { sessionId, startTime } = session;

  const result = await chrome.runtime.sendMessage({
    name: "startRecording",
    body: { mode: "tab", sessionId, startTime, targetTabId: tab.id },
  }) as { ok: boolean; error?: string };

  if (!result?.ok) { connLabel.textContent = result?.error ?? "Start failed"; setUI("idle"); return; }

  recording = true;
  setUI("recording");
  startTimer(startTime);
}

// Let user pick any screen/window/tab via the native Chrome picker
async function startPickerRecording() {
  setUI("busy");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { connLabel.textContent = "No active tab"; setUI("idle"); return; }

  const session = await createSession();
  if (!session) { setUI("idle"); return; }
  const { sessionId, startTime } = session;

  // Recording tab will show the picker itself (popup can't keep the picker open)
  const result = await chrome.runtime.sendMessage({
    name: "startRecording",
    body: { mode: "picker", sessionId, startTime, targetTabId: tab.id },
  }) as { ok: boolean; error?: string };

  if (!result?.ok) { connLabel.textContent = result?.error ?? "Start failed"; setUI("idle"); return; }

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

btnTab.addEventListener("click",  () => startTabRecording());
btnPick.addEventListener("click", () => startPickerRecording());
btnStop.addEventListener("click", () => stopRecording());

init();
