import * as http from "node:http";
import * as FS from "node:fs";
import * as Path from "node:path";
import Database from "better-sqlite3";
import { BrowserWindow } from "electron";

interface SessionState {
  sessionId: string;
  startTime: number;
  stemDir: string;
  dbPath: string;
  db: Database.Database;
  insertChrome: Database.Statement;
}

let activeCwd: string | null = null;
let session: SessionState | null = null;
let server: http.Server | null = null;
let getMainWindowFn: (() => BrowserWindow | null) | null = null;

export function setActiveCwd(cwd: string): void {
  activeCwd = cwd;
}

function openChromeDb(dbPath: string): { db: Database.Database; insertChrome: Database.Statement } {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chrome_events (
      id             INTEGER PRIMARY KEY,
      type           TEXT    NOT NULL,
      ts_ms          INTEGER NOT NULL,
      x              INTEGER,
      y              INTEGER,
      url            TEXT,
      page_title     TEXT,
      el_tag         TEXT,
      el_id          TEXT,
      el_text        TEXT,
      el_aria_label  TEXT,
      el_role        TEXT,
      el_placeholder TEXT,
      el_testid      TEXT,
      el_selector    TEXT,
      el_xpath       TEXT,
      el_classes     TEXT,
      el_bbox        TEXT,
      input_value    TEXT,
      key_combo      TEXT,
      scroll_dir     TEXT,
      nav_from       TEXT,
      nav_to         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chrome_ts ON chrome_events(ts_ms);
  `);
  const insertChrome = db.prepare(`
    INSERT INTO chrome_events (
      type, ts_ms, x, y, url, page_title,
      el_tag, el_id, el_text, el_aria_label, el_role, el_placeholder, el_testid,
      el_selector, el_xpath, el_classes, el_bbox,
      input_value, key_combo, scroll_dir, nav_from, nav_to
    ) VALUES (
      @type, @ts_ms, @x, @y, @url, @page_title,
      @el_tag, @el_id, @el_text, @el_aria_label, @el_role, @el_placeholder, @el_testid,
      @el_selector, @el_xpath, @el_classes, @el_bbox,
      @input_value, @key_combo, @scroll_dir, @nav_from, @nav_to
    )
  `);
  return { db, insertChrome };
}

function insertEvents(events: unknown[]): void {
  if (!session) return;
  const insertMany = session.db.transaction((rows: unknown[]) => {
    for (const raw of rows) {
      const e = raw as {
        type: string; ts_ms: number; x?: number | null; y?: number | null;
        url?: string; page_title?: string;
        element?: {
          tag?: string; id?: string; text?: string; aria_label?: string;
          role?: string; placeholder?: string; data_testid?: string;
          selector?: string; xpath?: string; classes?: string[];
          bbox?: { x: number; y: number; width: number; height: number };
        } | null;
        input_value?: string | null;
        key_combo?: string | null;
        scroll_dir?: string | null;
        nav_from?: string | null;
        nav_to?: string | null;
      };
      session!.insertChrome.run({
        type: e.type,
        ts_ms: e.ts_ms,
        x: e.x ?? null,
        y: e.y ?? null,
        url: e.url ?? null,
        page_title: e.page_title ?? null,
        el_tag: e.element?.tag ?? null,
        el_id: e.element?.id ?? null,
        el_text: e.element?.text ?? null,
        el_aria_label: e.element?.aria_label ?? null,
        el_role: e.element?.role ?? null,
        el_placeholder: e.element?.placeholder ?? null,
        el_testid: e.element?.data_testid ?? null,
        el_selector: e.element?.selector ?? null,
        el_xpath: e.element?.xpath ?? null,
        el_classes: e.element?.classes ? JSON.stringify(e.element.classes) : null,
        el_bbox: e.element?.bbox ? JSON.stringify(e.element.bbox) : null,
        input_value: e.input_value ?? null,
        key_combo: e.key_combo ?? null,
        scroll_dir: e.scroll_dir ?? null,
        nav_from: e.nav_from ?? null,
        nav_to: e.nav_to ?? null,
      });
    }
  });
  try { insertMany(events); } catch (err) { console.error("[chrome-bridge] insert error:", err); }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
  });
  res.end(json);
}

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, X-Session-Id", "Access-Control-Allow-Methods": "GET, POST" });
    res.end();
    return;
  }

  const url = req.url ?? "/";

  // GET /status
  if (req.method === "GET" && url === "/status") {
    jsonResponse(res, 200, {
      active: session !== null,
      sessionId: session?.sessionId ?? null,
      startTime: session?.startTime ?? null,
      cwd: activeCwd,
    });
    return;
  }

  // POST /session/start
  if (req.method === "POST" && url === "/session/start") {
    if (session) {
      jsonResponse(res, 409, { error: "Session already active" });
      return;
    }
    const cwd = activeCwd ?? Path.join(process.env["HOME"] ?? "/tmp", "recordings");
    const dir = Path.join(cwd, "recordings");
    FS.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const stem = ts;
    const stemDir = Path.join(dir, stem);
    const dbPath = Path.join(dir, `${stem}.db`);
    FS.mkdirSync(stemDir, { recursive: true });
    const startTime = Date.now();
    const sessionId = `chrome-${stem}`;
    const { db, insertChrome } = openChromeDb(dbPath);
    session = { sessionId, startTime, stemDir, dbPath, db, insertChrome };
    jsonResponse(res, 200, { sessionId, startTime, stem });
    return;
  }

  // POST /session/stop
  if (req.method === "POST" && url === "/session/stop") {
    if (session) {
      try { session.db.close(); } catch {}
      session = null;
    }
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // POST /events
  if (req.method === "POST" && url === "/events") {
    readBody(req).then((buf) => {
      try {
        const body = JSON.parse(buf.toString()) as { events: unknown[] };
        insertEvents(body.events ?? []);
        jsonResponse(res, 200, { ok: true });
      } catch (err) {
        jsonResponse(res, 400, { error: String(err) });
      }
    }).catch(() => jsonResponse(res, 500, { error: "read error" }));
    return;
  }

  // POST /recording  (binary webm blob)
  if (req.method === "POST" && url === "/recording") {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    // Determine stem from session or session id
    const stem = sessionId?.replace("chrome-", "") ?? new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
    const cwd = activeCwd ?? Path.join(process.env["HOME"] ?? "/tmp", "recordings");
    const webmPath = Path.join(cwd, "recordings", `${stem}.webm`);

    readBody(req).then((buf) => {
      FS.writeFile(webmPath, buf, (err) => {
        if (err) { jsonResponse(res, 500, { error: String(err) }); return; }
        jsonResponse(res, 200, { ok: true, path: webmPath });
        // Notify renderer to refresh list
        const win = getMainWindowFn?.();
        if (win && !win.isDestroyed()) {
          win.webContents.send("recorder:fileListChanged");
        }
      });
    }).catch(() => jsonResponse(res, 500, { error: "read error" }));
    return;
  }

  jsonResponse(res, 404, { error: "Not found" });
}

export function startChromeBridge(getMainWindow: () => BrowserWindow | null): void {
  getMainWindowFn = getMainWindow;
  server = http.createServer(handleRequest);
  server.listen(7878, "127.0.0.1", () => {
    console.log("[chrome-bridge] listening on localhost:7878");
  });
  server.on("error", (err) => {
    console.error("[chrome-bridge] server error:", err);
  });
}

export function stopChromeBridge(): void {
  if (session) {
    try { session.db.close(); } catch {}
    session = null;
  }
  server?.close();
  server = null;
}

export function queryChromeEvents(dbPath: string, fromMs: number, toMs: number): unknown[] {
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare("SELECT * FROM chrome_events WHERE ts_ms >= ? AND ts_ms <= ? ORDER BY ts_ms")
      .all(fromMs, toMs);
    db.close();
    return rows;
  } catch {
    return [];
  }
}
