import { contextBridge, ipcRenderer } from "electron";

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
};

contextBridge.exposeInMainWorld("electronAPI", api);
