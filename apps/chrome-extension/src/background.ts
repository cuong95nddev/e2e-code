export {};
const BRIDGE_URL = "http://localhost:7878";

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
});

// ---- Start ----

async function handleStart(body: {
  streamId: string;
  sessionId: string;
  startTime: number;
  targetTabId: number;
}): Promise<{ ok: boolean }> {
  const { streamId, sessionId, startTime, targetTabId } = body;

  // Create the dedicated recording tab (pinned, starts active so getUserMedia works)
  const recTab = await chrome.tabs.create({
    url: chrome.runtime.getURL("recording.html"),
    pinned: true,
    active: true,
  });

  // Wait for it to fully load
  await waitForTabLoad(recTab.id!);

  // Hand off the stream ID so it can start MediaRecorder
  await chrome.tabs.sendMessage(recTab.id!, { name: "doRecord", streamId, sessionId });

  // Persist state
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

  // Switch user back to the tab they're recording
  await chrome.tabs.update(targetTabId, { active: true });

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

// If the recording tab is closed manually, reset state
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await chrome.storage.session.get(["recordingTabId", "recording"]);
  if (s["recording"] && s["recordingTabId"] === tabId) {
    await chrome.storage.session.set({ recording: false, recordingTabId: null });
  }
});
