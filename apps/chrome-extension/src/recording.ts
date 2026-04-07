export {};

const BRIDGE_URL = "http://localhost:7878";

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let sessionId: string | null = null;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.name === "doRecord") {
    startRecording(msg.streamId, msg.sessionId)
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

async function startRecording(streamId: string, sid: string): Promise<void> {
  sessionId = sid;
  chunks = [];

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error Chrome-specific constraint
      mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
    },
  });

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

  const videoBlob = new Blob(chunks, { type: "video/webm" });
  const sid = sessionId;
  recorder = null; stream = null; chunks = []; sessionId = null;

  await fetch(`${BRIDGE_URL}/recording`, {
    method: "POST",
    headers: { "Content-Type": "video/webm", "X-Session-Id": sid },
    body: videoBlob,
    signal: AbortSignal.timeout(120000),
  }).catch(() => {});

  window.close();
}
