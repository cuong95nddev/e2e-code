import { contextBridge, ipcRenderer } from "electron";

export interface RecordingMeta {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  dbPath?: string;
}

export interface ActionEvent {
  id: number;
  type: string;
  ts_ms: number;
  x: number | null;
  y: number | null;
  button: number | null;
  keycode: number | null;
  key_char: string | null;
  modifiers: string | null;
  delta_x: number | null;
  delta_y: number | null;
}

export interface FrameEntry {
  path: string;
  ts_ms: number;
}

export interface ChromeEvent {
  id: number;
  type: string;
  ts_ms: number;
  x: number | null;
  y: number | null;
  url: string | null;
  page_title: string | null;
  el_tag: string | null;
  el_id: string | null;
  el_text: string | null;
  el_aria_label: string | null;
  el_role: string | null;
  el_placeholder: string | null;
  el_testid: string | null;
  el_selector: string | null;
  el_xpath: string | null;
  el_classes: string | null;   // JSON array string
  el_bbox: string | null;      // JSON {x,y,width,height} string
  input_value: string | null;
  key_combo: string | null;
  scroll_dir: string | null;
  nav_from: string | null;
  nav_to: string | null;
}

export interface ElectronAPI {
  pty: {
    create(sessionId: string, cwd: string, cliSessionId: string | null, isResume: boolean): Promise<void>;
    write(sessionId: string, data: string): void;
    resize(sessionId: string, cols: number, rows: number): void;
    kill(sessionId: string): Promise<void>;
    onData(callback: (sessionId: string, data: string) => void): () => void;
    onExit(callback: (sessionId: string, exitCode: number, signal?: number) => void): () => void;
  };
  app: {
    pickFolder(): Promise<string | null>;
    openExternal(url: string): Promise<void>;
  };
  recorder: {
    getSources(): Promise<{ id: string; name: string; thumbnail: string /* base64 data URL */ }[]>;
    openOverlay(screenSourceId: string): Promise<{ x: number; y: number; width: number; height: number } | null>;
    saveFile(cwd: string, buffer: ArrayBuffer, stem?: string): Promise<string>;
    listFiles(cwd: string): Promise<RecordingMeta[]>;
    onTogglePicker(callback: () => void): () => void;
    showTray(): void;
    hideTray(): void;
    onStopFromTray(callback: () => void): () => void;
    sessionStart(cwd: string): Promise<{ dbPath: string | null; stem: string; startTime: number; captureActive: boolean }>;
    sessionStop(): Promise<void>;
    queryActions(dbPath: string, fromMs: number, toMs: number): Promise<ActionEvent[]>;
    saveFrame(framePath: string, buffer: ArrayBuffer): Promise<void>;
    writeFile(filePath: string, content: string): Promise<void>;
    queryChrome(dbPath: string, fromMs: number, toMs: number): Promise<ChromeEvent[]>;
    onFileListChanged(callback: () => void): () => void;
    readFile(filePath: string): Promise<string | null>;
    listFrames(framesDir: string): Promise<FrameEntry[]>;
    watchResult(stemDir: string): Promise<void>;
    unwatchResult(stemDir: string): Promise<void>;
    onAnalysisReady(callback: (stemDir: string) => void): () => void;
  };
  chrome: {
    setActiveCwd(cwd: string): Promise<void>;
  };
}

function onChannel(channel: string, callback: (...args: unknown[]) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: ElectronAPI = {
  pty: {
    create: (sessionId, cwd, cliSessionId, isResume) =>
      ipcRenderer.invoke("pty:create", sessionId, cwd, cliSessionId, isResume),
    write: (sessionId, data) =>
      ipcRenderer.send("pty:write", sessionId, data),
    resize: (sessionId, cols, rows) =>
      ipcRenderer.send("pty:resize", sessionId, cols, rows),
    kill: (sessionId) =>
      ipcRenderer.invoke("pty:kill", sessionId),
    onData: (callback) =>
      onChannel("pty:data", (sessionId, data) =>
        callback(sessionId as string, data as string)),
    onExit: (callback) =>
      onChannel("pty:exit", (sessionId, exitCode, signal) =>
        callback(sessionId as string, exitCode as number, signal as number | undefined)),
  },
  app: {
    pickFolder: () => ipcRenderer.invoke("app:pickFolder"),
    openExternal: (url: string) => ipcRenderer.invoke("app:openExternal", url),
  },
  recorder: {
    getSources: () => ipcRenderer.invoke("recorder:getSources"),
    openOverlay: (screenSourceId: string) => ipcRenderer.invoke("recorder:openOverlay", screenSourceId),
    saveFile: (cwd: string, buffer: ArrayBuffer, stem?: string) =>
      ipcRenderer.invoke("recorder:saveFile", cwd, buffer, stem),
    listFiles: (cwd: string) => ipcRenderer.invoke("recorder:listFiles", cwd),
    onTogglePicker: (callback: () => void) => onChannel("recorder:togglePicker", callback),
    showTray: () => ipcRenderer.send("recorder:showTray"),
    hideTray: () => ipcRenderer.send("recorder:hideTray"),
    onStopFromTray: (callback: () => void) => onChannel("recorder:stopFromTray", callback),
    sessionStart: (cwd: string) => ipcRenderer.invoke("recorder:sessionStart", cwd),
    sessionStop: () => ipcRenderer.invoke("recorder:sessionStop"),
    queryActions: (dbPath: string, fromMs: number, toMs: number) =>
      ipcRenderer.invoke("actions:query", dbPath, fromMs, toMs),
    saveFrame: (framePath: string, buffer: ArrayBuffer) =>
      ipcRenderer.invoke("recorder:saveFrame", framePath, buffer),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke("recorder:writeFile", filePath, content),
    queryChrome: (dbPath: string, fromMs: number, toMs: number) =>
      ipcRenderer.invoke("recorder:queryChrome", dbPath, fromMs, toMs),
    onFileListChanged: (callback: () => void) =>
      onChannel("recorder:fileListChanged", callback),
    readFile: (filePath: string) =>
      ipcRenderer.invoke("recorder:readFile", filePath),
    listFrames: (framesDir: string) =>
      ipcRenderer.invoke("recorder:listFrames", framesDir),
    watchResult: (stemDir: string) =>
      ipcRenderer.invoke("recorder:watchResult", stemDir),
    unwatchResult: (stemDir: string) =>
      ipcRenderer.invoke("recorder:unwatchResult", stemDir),
    onAnalysisReady: (callback: (stemDir: string) => void) =>
      onChannel("recorder:analysisReady", (stemDir) => callback(stemDir as string)),
  },
  chrome: {
    setActiveCwd: (cwd: string) => ipcRenderer.invoke("chrome:setActiveCwd", cwd),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
