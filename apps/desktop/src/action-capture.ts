import * as Path from "node:path";
import * as FS from "node:fs";
import Database from "better-sqlite3";
import { uIOhook, UiohookMouseEvent, UiohookKeyboardEvent, UiohookWheelEvent } from "uiohook-napi";
import { ipcMain, systemPreferences } from "electron";

interface SessionState {
  db: Database.Database;
  insert: Database.Statement;
  startTime: number;
}

let session: SessionState | null = null;

function tsMs(): number {
  if (!session) return 0;
  return Date.now() - session.startTime;
}

function ins(row: {
  type: string;
  x?: number | null;
  y?: number | null;
  button?: number | null;
  keycode?: number | null;
  key_char?: string | null;
  modifiers?: string | null;
  delta_x?: number | null;
  delta_y?: number | null;
}): void {
  if (!session) return;
  try {
    session.insert.run({
      type: row.type,
      ts_ms: tsMs(),
      x: row.x ?? null,
      y: row.y ?? null,
      button: row.button ?? null,
      keycode: row.keycode ?? null,
      key_char: row.key_char ?? null,
      modifiers: row.modifiers ?? null,
      delta_x: row.delta_x ?? null,
      delta_y: row.delta_y ?? null,
    });
  } catch (err) {
    console.error("[action-capture] insert error:", err);
  }
}

function kmods(e: UiohookKeyboardEvent): string {
  return JSON.stringify({ ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey });
}

const handlers = {
  mousedown: (e: UiohookMouseEvent) => ins({ type: "mousedown", x: e.x, y: e.y, button: e.button as number }),
  mouseup:   (e: UiohookMouseEvent) => ins({ type: "mouseup",   x: e.x, y: e.y, button: e.button as number }),
  keydown:   (e: UiohookKeyboardEvent) => ins({ type: "keydown", keycode: e.keycode, modifiers: kmods(e) }),
  keyup:     (e: UiohookKeyboardEvent) => ins({ type: "keyup",   keycode: e.keycode, modifiers: kmods(e) }),
  wheel:     (e: UiohookWheelEvent) => ins({ type: "wheel", x: e.x, y: e.y, delta_y: e.rotation }),
};

function openDb(dbPath: string, startTime: number): SessionState {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY,
      type      TEXT    NOT NULL,
      ts_ms     INTEGER NOT NULL,
      x         INTEGER,
      y         INTEGER,
      button    INTEGER,
      keycode   INTEGER,
      key_char  TEXT,
      modifiers TEXT,
      delta_x   REAL,
      delta_y   REAL
    );
    CREATE INDEX IF NOT EXISTS idx_ts ON events(ts_ms);
  `);
  const insert = db.prepare(`
    INSERT INTO events (type, ts_ms, x, y, button, keycode, key_char, modifiers, delta_x, delta_y)
    VALUES (@type, @ts_ms, @x, @y, @button, @keycode, @key_char, @modifiers, @delta_x, @delta_y)
  `);
  return { db, insert, startTime };
}

export function startCapture(dbPath: string, startTime: number = Date.now()): { captureActive: boolean } {
  if (session) {
    uIOhook.stop();
    uIOhook.off("mousedown", handlers.mousedown);
    uIOhook.off("mouseup",   handlers.mouseup);
    uIOhook.off("keydown",   handlers.keydown);
    uIOhook.off("keyup",     handlers.keyup);
    uIOhook.off("wheel",     handlers.wheel);
    session.db.close();
    session = null;
  }

  // macOS: check Accessibility permission (prompt=true shows system dialog)
  if (process.platform === "darwin") {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    if (!trusted) {
      return { captureActive: false };
    }
  }

  FS.mkdirSync(Path.dirname(dbPath), { recursive: true });
  session = openDb(dbPath, startTime);

  uIOhook.on("mousedown", handlers.mousedown);
  uIOhook.on("mouseup",   handlers.mouseup);
  uIOhook.on("keydown",   handlers.keydown);
  uIOhook.on("keyup",     handlers.keyup);
  uIOhook.on("wheel",     handlers.wheel);
  uIOhook.start();
  return { captureActive: true };
}

export function stopCapture(): void {
  if (!session) return;
  uIOhook.stop();
  uIOhook.off("mousedown", handlers.mousedown);
  uIOhook.off("mouseup",   handlers.mouseup);
  uIOhook.off("keydown",   handlers.keydown);
  uIOhook.off("keyup",     handlers.keyup);
  uIOhook.off("wheel",     handlers.wheel);
  session.db.close();
  session = null;
}

export function registerActionCaptureHandlers(): void {
  ipcMain.handle("actions:query", async (_event, dbPath: string, fromMs: number, toMs: number) => {
    if (!dbPath || !Path.isAbsolute(dbPath)) return [];
    try {
      const qdb = new Database(dbPath, { readonly: true });
      const rows = qdb
        .prepare("SELECT * FROM events WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms")
        .all(fromMs, toMs);
      qdb.close();
      return rows;
    } catch {
      return [];
    }
  });
}
