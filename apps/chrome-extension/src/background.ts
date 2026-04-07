export {};
const BRIDGE_URL = "http://localhost:7878";

// ---- Event buffer (survives content-script restarts / page refreshes) ----

let eventBuffer: unknown[] = [];
let currentSessionId: string | null = null;

async function flushEventsToBridge(): Promise<void> {
  if (!currentSessionId || eventBuffer.length === 0) return;
  const events = eventBuffer;
  eventBuffer = [];
  await fetch(`${BRIDGE_URL}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: currentSessionId, events }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    // Put events back on failure so they're not lost
    eventBuffer = [...events, ...eventBuffer];
  });
}

// ---- Message router ----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.name === "startRecording") {
    handleStart(msg.body)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.name === "stopRecording") {
    handleStop()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  // Content script forwards events here instead of calling bridge directly
  if (msg.name === "recordEvents") {
    const events = msg.events as unknown[];
    if (Array.isArray(events) && events.length > 0) {
      eventBuffer.push(...events);
      flushEventsToBridge().catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }
});

// ---- Start ----

async function handleStart(body: {
  sessionId: string;
  startTime: number;
  targetTabId: number;
}): Promise<{ ok: boolean }> {
  const { sessionId, startTime, targetTabId } = body;

  // Create the dedicated recording tab (pinned, starts active so chooseDesktopMedia works)
  const recTab = await chrome.tabs.create({
    url: chrome.runtime.getURL("recording.html"),
    pinned: true,
    active: true,
  });

  // Wait for it to fully load
  await waitForTabLoad(recTab.id!);

  // Set in-memory session for event buffering
  currentSessionId = sessionId;
  eventBuffer = [];

  // Persist state before the picker opens
  await chrome.storage.session.set({
    recording: true,
    targetTabId,
    recordingTabId: recTab.id,
    sessionId,
    startTime,
  });

  // Ensure content script is running on the target tab
  try {
    await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ["content-script.js"] });
  } catch { /* already injected */ }

  // Tell content script to begin capturing events
  try {
    await chrome.tabs.sendMessage(targetTabId, { name: "startEvents", sessionId, startTime });
  } catch (e) {
    console.warn("[bg] startEvents failed:", e);
  }

  // Fire-and-forget: recording tab shows picker then starts MediaRecorder.
  // It also switches the user back to targetTab once recording begins.
  chrome.tabs.sendMessage(recTab.id!, { name: "doRecord", sessionId, targetTabId }).catch(() => {});

  return { ok: true };
}

// ---- Stop ----

async function handleStop(): Promise<{ ok: boolean }> {
  const s = await chrome.storage.session.get(["recordingTabId", "targetTabId", "sessionId"]);
  const { recordingTabId, targetTabId, sessionId } = s as Record<string, number | string | null>;

  // Stop DOM event capture and flush events to bridge
  if (targetTabId) {
    try { await chrome.tabs.sendMessage(targetTabId as number, { name: "stopEvents" }); } catch { /* tab closed */ }
  }

  // Stop video recorder (it POSTs video and closes itself)
  if (recordingTabId) {
    try { await chrome.tabs.sendMessage(recordingTabId as number, { name: "stopRecord" }); } catch { /* tab closed */ }
  }

  // Flush any buffered events before stopping
  await flushEventsToBridge();
  currentSessionId = null;
  eventBuffer = [];

  // Finalize session on bridge
  if (sessionId) {
    await fetch(`${BRIDGE_URL}/session/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  await chrome.storage.session.set({
    recording: false,
    targetTabId: null,
    recordingTabId: null,
    sessionId: null,
    startTime: null,
  });

  return { ok: true };
}

// ---- Helpers ----

function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

// Re-inject content script and resume event capture after target tab navigates/reloads
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  const s = await chrome.storage.session.get(["recording", "targetTabId", "sessionId", "startTime"]);
  if (!s["recording"] || s["targetTabId"] !== tabId) return;
  const { sessionId, startTime } = s as { sessionId: string; startTime: number };
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content-script.js"] });
  } catch { /* already injected */ }
  try {
    await chrome.tabs.sendMessage(tabId, { name: "startEvents", sessionId, startTime });
  } catch (e) {
    console.warn("[bg] re-startEvents after reload failed:", e);
  }
});

// If the recording tab is closed manually, reset state
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await chrome.storage.session.get(["recordingTabId", "recording"]);
  if (s["recording"] && s["recordingTabId"] === tabId) {
    await chrome.storage.session.set({ recording: false, recordingTabId: null });
  }
});
