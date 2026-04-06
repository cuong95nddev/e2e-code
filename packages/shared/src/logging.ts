import * as FS from "node:fs";
import * as Path from "node:path";

export class RotatingFileSink {
  private readonly dir: string;
  private readonly prefix: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private currentPath: string | null = null;
  private currentSize = 0;

  constructor(options: {
    dir: string;
    prefix: string;
    maxBytes?: number;
    maxFiles?: number;
  }) {
    this.dir = options.dir;
    this.prefix = options.prefix;
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 10;
    FS.mkdirSync(this.dir, { recursive: true });
    this.rotate();
  }

  write(data: string): void {
    if (this.currentPath === null) this.rotate();
    const bytes = Buffer.byteLength(data);
    if (this.currentSize + bytes > this.maxBytes) this.rotate();
    FS.appendFileSync(this.currentPath!, data);
    this.currentSize += bytes;
  }

  private rotate(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.currentPath = Path.join(this.dir, `${this.prefix}-${ts}.log`);
    this.currentSize = 0;
    this.cleanup();
  }

  private cleanup(): void {
    const files = FS.readdirSync(this.dir)
      .filter((f) => f.startsWith(this.prefix) && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const file of files.slice(this.maxFiles)) {
      FS.unlinkSync(Path.join(this.dir, file));
    }
  }
}
