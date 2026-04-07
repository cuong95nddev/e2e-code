interface RecorderSource {
  id: string;
  name: string;
  thumbnail: string; // base64 data URL
}

interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ElectronAPI {
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
    getSources(): Promise<RecorderSource[]>;
    openOverlay(screenSourceId: string): Promise<ScreenRegion | null>;
    saveFile(cwd: string, buffer: ArrayBuffer): Promise<string>;
    onTogglePicker(callback: () => void): () => void;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
