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
    sessionStart(cwd: string): Promise<{ dbPath: string; stem: string; startTime: number }>;
    sessionStop(): Promise<void>;
    queryActions(dbPath: string, fromMs: number, toMs: number): Promise<ActionEvent[]>;
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
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
