export {};

import { webmFixDuration } from "webm-fix-duration";

const BRIDGE_URL = "http://localhost:7878";

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let sessionId: string | null = null;
let recordingStart = 0;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.name === "doRecord") {
    startRecording(msg.mode, msg.sessionId, msg.targetTabId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.name === "stopRecord") {
    stopRecording()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

async function startRecording(
  mode: "tab" | "picker",
  sid: string,
  targetTabId: number,
): Promise<void> {
  sessionId = sid;
  chunks = [];

  let streamId: string;
  let chromeMediaSource: string;

  if (mode === "tab") {
    // Obtain stream ID here in the recording tab — avoids expiry from popup handoff
    streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) => {
        if (chrome.runtime.lastError || !id) reject(chrome.runtime.lastError ?? new Error("no streamId"));
        else resolve(id);
      });
    });
    chromeMediaSource = "tab";
    await chrome.tabs.update(targetTabId, { active: true });
  } else {
    // Show the native Chrome source picker (Entire Screen / Window / Chrome Tab)
    streamId = await new Promise<string>((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(
        ["screen", "window", "tab"],
        (id) => {
          if (!id) { window.close(); reject(new Error("cancelled")); }
          else resolve(id);
        }
      );
    });
    chromeMediaSource = "desktop";
    // Switch user back to the target tab now that picker is dismissed
    await chrome.tabs.update(targetTabId, { active: true });
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome-specific constraint
      mandatory: { chromeMediaSource, chromeMediaSourceId: streamId },
    },
  });

  recordingStart = Date.now();
  recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start(1000);
}

async function stopRecording(): Promise<void> {
  if (!recorder || !sessionId) return;

  await new Promise<void>((resolve) => {
    recorder!.onstop = () => resolve();
    recorder!.stop();
  });
  stream?.getTracks().forEach((t) => t.stop());

  const rawBlob = new Blob(chunks, { type: "video/webm" });
  const videoBlob = await webmFixDuration(rawBlob, Date.now() - recordingStart);
  const sid = sessionId;
  recorder = null; stream = null; chunks = []; sessionId = null; recordingStart = 0;

  await fetch(`${BRIDGE_URL}/recording`, {
    method: "POST",
    headers: { "Content-Type": "video/webm", "X-Session-Id": sid },
    body: videoBlob,
    signal: AbortSignal.timeout(120000),
  }).catch(() => {});

  window.close();
}
