import * as pty from "node-pty";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface PtyInstance {
  process: pty.IPty;
  sessionId: string;
}

const ptys = new Map<string, PtyInstance>();

/**
 * Get the full PATH by sourcing the user's login shell.
 * When Electron is launched from macOS Finder/Dock, process.env.PATH
 * is minimal (/usr/bin:/bin:/usr/sbin:/sbin) and misses nvm, homebrew, etc.
 */
let cachedFullPath: string | null = null;

export function getFullPath(): string {
  if (cachedFullPath) return cachedFullPath;

  const shell = process.env.SHELL || "/bin/zsh";
  const currentPath = process.env.PATH || "";

  try {
    const shellPath = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    const match = shellPath.match(/__PATH__=(.+)/);
    if (match?.[1]) {
      cachedFullPath = match[1].trim();
      return cachedFullPath;
    }
  } catch (err) {
    console.warn("Failed to resolve PATH from login shell:", err);
  }

  const home = os.homedir();
  const extraDirs = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/usr/local/sbin",
    "/opt/homebrew/sbin",
  ];

  const pathSet = new Set(currentPath.split(":"));
  for (const dir of extraDirs) {
    pathSet.add(dir);
  }
  cachedFullPath = Array.from(pathSet).join(":");
  return cachedFullPath;
}

let cachedBinaryPath: string | null = null;

function resolveClaudeBinary(): string {
  if (cachedBinaryPath) return cachedBinaryPath;

  const fullPath = getFullPath();
  const shell = process.env.SHELL || "/bin/zsh";

  // Method 1: Use login shell to resolve (most reliable on macOS)
  try {
    const output = execSync(`${shell} -ilc 'which claude'`, {
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    // Interactive shell may emit init messages before the path — take the last non-empty line
    const resolved = output.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
    if (resolved && !resolved.includes("not found") && resolved.startsWith("/")) {
      cachedBinaryPath = resolved;
      return cachedBinaryPath;
    }
  } catch {
    // fall through
  }

  // Method 2: Direct which with full PATH
  try {
    const resolved = execSync("which claude", {
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, PATH: fullPath },
    }).trim();
    if (resolved && !resolved.includes("not found") && resolved.startsWith("/")) {
      cachedBinaryPath = resolved;
      return cachedBinaryPath;
    }
  } catch {
    // fall through
  }

  // Method 3: Check common locations
  const home = os.homedir();
  const candidates = [
    path.join(home, ".npm-global", "bin", "claude"),
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(home, ".local", "bin", "claude"),
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        cachedBinaryPath = candidate;
        return cachedBinaryPath;
      }
    } catch {
      // not found
    }
  }

  // Fallback
  return "claude";
}

export function spawnPty(
  sessionId: string,
  cwd: string,
  cliSessionId: string | null,
  isResume: boolean,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void,
): void {
  if (ptys.has(sessionId)) {
    killPty(sessionId);
  }

  const args: string[] = [];
  if (cliSessionId) {
    if (isResume) {
      args.push("-r", cliSessionId);
    } else {
      args.push("--session-id", cliSessionId);
    }
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PATH: getFullPath(),
  };
  delete env.CLAUDE_CODE;

  const binary = resolveClaudeBinary();
  console.log(`[pty-manager] Resolved claude binary: ${binary}`);
  console.log(`[pty-manager] PATH: ${env.PATH?.substring(0, 200)}...`);

  const ptyProcess = pty.spawn(binary, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    const current = ptys.get(sessionId);
    if (current?.process === ptyProcess) {
      ptys.delete(sessionId);
    }
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

export function writePty(sessionId: string, data: string): void {
  ptys.get(sessionId)?.process.write(data);
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  ptys.get(sessionId)?.process.resize(cols, rows);
}

export function killPty(sessionId: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.kill();
    ptys.delete(sessionId);
  }
}

export function killAllPtys(): void {
  for (const [id] of ptys) {
    killPty(id);
  }
}
