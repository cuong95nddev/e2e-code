import { useState, useRef, useCallback } from "react";

export type RecorderState = "idle" | "recording";

export type RecorderMode = "screen" | "window" | "region";

interface StartOptions {
  sourceId: string;
  mode: RecorderMode;
  cropRegion?: { x: number; y: number; width: number; height: number };
  cwd: string;
}

export function useRecorder() {
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rafRef = useRef<number | null>(null);
  const videoElemRef = useRef<HTMLVideoElement | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const cwdRef = useRef<string>("");

  const startRecording = useCallback(async (opts: StartOptions) => {
    cwdRef.current = opts.cwd;

    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // @ts-expect-error Electron-specific constraint
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: opts.sourceId,
        },
      },
    });

    rawStreamRef.current = rawStream;
    let recordStream: MediaStream = rawStream;

    if (opts.cropRegion) {
      const { x, y, width, height } = opts.cropRegion;
      const dpr = window.devicePixelRatio;

      const video = document.createElement("video");
      video.srcObject = rawStream;
      video.muted = true;
      await video.play();
      videoElemRef.current = video;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d")!;

      const drawFrame = () => {
        ctx.drawImage(video, -Math.round(x * dpr), -Math.round(y * dpr));
        rafRef.current = requestAnimationFrame(drawFrame);
      };
      rafRef.current = requestAnimationFrame(drawFrame);

      recordStream = canvas.captureStream(30);
    }

    chunksRef.current = [];
    const recorder = new MediaRecorder(recordStream, { mimeType: "video/webm;codecs=vp8" });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(1000);
    mediaRecorderRef.current = recorder;

    setElapsed(0);
    setSavedPath(null);
    setRecorderState("recording");
    timerRef.current = setInterval(() => setElapsed((n) => n + 1), 1000);
  }, []);

  const stopRecording = useCallback(async (): Promise<string> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorderState !== "recording") return "";

    return new Promise((resolve, reject) => {
      recorder.onstop = async () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        if (videoElemRef.current) { videoElemRef.current.srcObject = null; videoElemRef.current = null; }
        if (rawStreamRef.current) { rawStreamRef.current.getTracks().forEach((t) => t.stop()); rawStreamRef.current = null; }

        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const buffer = await blob.arrayBuffer();
        try {
          const path = await window.electronAPI.recorder.saveFile(cwdRef.current, buffer);
          setSavedPath(path);
          setRecorderState("idle");
          resolve(path);
        } catch (err) {
          reject(err);
        }
      };
      recorder.stop();
      mediaRecorderRef.current = null;
    });
  }, [recorderState]);

  return { recorderState, elapsed, savedPath, startRecording, stopRecording };
}
