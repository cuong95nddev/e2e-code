import type { ChromeEvent, ContentMessage } from "./types";

const BRIDGE_URL = "http://localhost:7878";
const BATCH_INTERVAL_MS = 500;
const MAX_BUFFER = 1000;

interface SessionState {
  sessionId: string;
  startTime: number;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  timerInterval: ReturnType<typeof setInterval> | null;
  elapsedSeconds: number;
}

let session: SessionState | null = null;
let eventBuffer: ChromeEvent[] = [];
let batchTimer: ReturnType<typeof setInterval> | null = null;

// --- HTTP helpers ---

async function isConnected(): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

async function postJSON(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

async function postBinary(path: string, blob: Blob, sessionId: string): Promise<Response | null> {
  try {
    return await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "video/webm",
        "X-Session-Id": sessionId,
      },
      body: blob,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    return null;
  }
}

// --- Event batching ---

function startBatchTimer(): void {
  if (batchTimer) return;
  batchTimer = setInterval(flushEvents, BATCH_INTERVAL_MS);
}

function stopBatchTimer(): void {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null; }
}

async function flushEvents(): Promise<void> {
  if (eventBuffer.length === 0) return;
  const batch = eventBuffer.splice(0, eventBuffer.length);
  await postJSON("/events", { sessionId: session?.sessionId, events: batch });
}

// --- Session lifecycle ---

async function startSession(tabId: number): Promise<{ ok: boolean; error?: string }> {
  const connected = await isConnected();
  if (!connected) return { ok: false, error: "Cannot reach Electron app on localhost:7878" };

  // Start tab capture
  const stream = await new Promise<MediaStream | null>((resolve) => {
    chrome.tabCapture.capture({ video: true, audio: false }, (s) => resolve(s ?? null));
  });
  if (!stream) return { ok: false, error: "tabCapture failed — is the tab active?" };

  // Start session on Electron side
  const res = await postJSON("/session/start", {});
  if (!res || !res.ok) {
    stream.getTracks().forEach((t) => t.stop());
    return { ok: false, error: "Electron rejected session start" };
  }
  const { sessionId, startTime } = await res.json() as { sessionId: string; startTime: number };

  // Set up MediaRecorder
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  session = {
    sessionId, startTime, stream, recorder, chunks,
    timerInterval: null, elapsedSeconds: 0,
  };

  recorder.start(1000); // collect chunks every second

  // Tell all content scripts the start time so ts_ms offsets are correct
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { kind: "session_start_time", startTime } satisfies ContentMessage)
        .catch(() => {}); // ignore tabs without content script
    }
  }

  // Start batching events
  eventBuffer = [];
  startBatchTimer();

  // Start elapsed timer
  session.timerInterval = setInterval(() => {
    if (!session) return;
    session.elapsedSeconds++;
    chrome.storage.session.set({ elapsedSeconds: session.elapsedSeconds });
  }, 1000);

  chrome.storage.session.set({ recording: true, elapsedSeconds: 0 });
  return { ok: true };
}

async function stopSession(): Promise<void> {
  if (!session) return;
  const { sessionId, stream, recorder, chunks, timerInterval } = session;

  if (timerInterval) clearInterval(timerInterval);
  stopBatchTimer();
  await flushEvents(); // flush remaining events

  // Stop recorder and collect final blob
  await new Promise<void>((resolve) => {
    recorder!.onstop = () => resolve();
    recorder!.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: "video/webm" });

  // Notify Electron session is stopping (so it can finalize DB)
  await postJSON("/session/stop", { sessionId });

  // Send video
  await postBinary("/recording", blob, sessionId);

  session = null;
  chrome.storage.session.set({ recording: false, elapsedSeconds: 0 });
}

// --- Message handler from content scripts ---

chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, _sendResponse) => {
  if (msg.kind === "event" && session) {
    if (eventBuffer.length < MAX_BUFFER) {
      eventBuffer.push(msg.event);
    }
  }
});

// --- External messages from popup ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;

  // Send current state immediately
  chrome.storage.session.get(["recording", "elapsedSeconds"]).then((s) => {
    port.postMessage({ type: "state", recording: s["recording"] ?? false, elapsedSeconds: s["elapsedSeconds"] ?? 0 });
  });

  isConnected().then((ok) => port.postMessage({ type: "connected", ok }));

  port.onMessage.addListener(async (msg: { action: "start" | "stop"; tabId?: number }) => {
    if (msg.action === "start" && msg.tabId != null) {
      const result = await startSession(msg.tabId);
      port.postMessage({ type: "start_result", ...result });
    }
    if (msg.action === "stop") {
      await stopSession();
      port.postMessage({ type: "stopped" });
    }
  });
});
