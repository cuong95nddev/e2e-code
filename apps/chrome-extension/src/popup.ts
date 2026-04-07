const btn = document.getElementById("btn") as HTMLButtonElement;
const connDot = document.getElementById("conn-dot") as HTMLDivElement;
const connLabel = document.getElementById("conn-label") as HTMLSpanElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const eventCountEl = document.getElementById("event-count") as HTMLDivElement;

let recording = false;
let elapsedSeconds = 0;

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function updateUI(): void {
  if (recording) {
    btn.textContent = "Stop Recording";
    btn.className = "stop";
    timerEl.style.display = "block";
    timerEl.textContent = `● ${formatTime(elapsedSeconds)}`;
    connDot.className = "dot recording";
    connLabel.textContent = "Recording…";
  } else {
    btn.textContent = "Start Recording";
    btn.className = "start";
    timerEl.style.display = "none";
    connDot.className = "dot";
    connLabel.textContent = "Not recording";
  }
}

const port = chrome.runtime.connect({ name: "popup" });

port.onMessage.addListener((msg: { type: string; ok?: boolean; recording?: boolean; elapsedSeconds?: number; error?: string }) => {
  if (msg.type === "connected") {
    if (msg.ok) {
      connDot.classList.add("connected");
      connLabel.textContent = recording ? "Recording…" : "Connected to e2e-code";
      btn.disabled = false;
    } else {
      connDot.className = "dot";
      connLabel.textContent = "e2e-code app not running";
      btn.disabled = true;
    }
  }
  if (msg.type === "state") {
    recording = msg.recording ?? false;
    elapsedSeconds = msg.elapsedSeconds ?? 0;
    updateUI();
  }
  if (msg.type === "start_result") {
    if (!msg.ok) {
      connLabel.textContent = msg.error ?? "Failed to start";
      btn.disabled = false;
    }
  }
  if (msg.type === "stopped") {
    connLabel.textContent = "Saved — check e2e-code app";
  }
});

// Tick elapsed timer locally
setInterval(() => {
  if (recording) {
    elapsedSeconds++;
    timerEl.textContent = `● ${formatTime(elapsedSeconds)}`;
  }
}, 1000);

btn.addEventListener("click", async () => {
  btn.disabled = true;
  if (!recording) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    port.postMessage({ action: "start", tabId: tab?.id });
    recording = true;
    elapsedSeconds = 0;
    updateUI();
  } else {
    port.postMessage({ action: "stop" });
    recording = false;
    updateUI();
    connLabel.textContent = "Saving…";
  }
  btn.disabled = false;
});

updateUI();
