interface RecorderSource {
  id: string;
  name: string;
  thumbnail: string;
}

interface RecordingMeta {
  name: string;
  path: string;
  size: number;
  createdAt: string;
  dbPath?: string;
}

interface ActionEvent {
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

interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ChromeEvent {
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
  };
  chrome: {
    setActiveCwd(cwd: string): Promise<void>;
  };
}

interface Window {
  electronAPI: ElectronAPI;
}
