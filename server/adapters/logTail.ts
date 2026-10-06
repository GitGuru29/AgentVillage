import { watch, existsSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import type { RawEvent } from "../events";

export type LineParser = (line: string, ctx: TailContext) => RawEvent | null | undefined;

export interface TailContext {
  path: string;
  agent_id: string;
  name: string;
}

export interface TailOptions {
  path: string;
  agent_id: string;
  name: string;
  parser: LineParser;
  /** Read this many bytes from EOF on start (default: only new data). */
  startAt?: "end" | "beginning";
}

/**
 * Tails a log file and feeds each complete line to `parser`.
 * Handles appends, truncation/rotation (inode change) and missing-at-start
 * files (retries until they appear).
 */
export class LogTailer {
  private handle: import("node:fs/promises").FileHandle | null = null;
  private offset = 0;
  private partial = "";
  private inode: bigint | null = null;
  private watcher: import("node:fs").FSWatcher | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private opts: TailOptions) {}

  async start(): Promise<void> {
    if (this.stopped) return;
    if (!existsSync(this.opts.path)) {
      this.retryTimer = setTimeout(() => void this.start(), 2000);
      return;
    }
    const st = statSync(this.opts.path);
    this.inode = BigInt(st.ino);
    this.handle = await open(this.opts.path, "r");
    this.offset =
      this.opts.startAt === "beginning" ? 0 : st.size;

    await this.drain();
    this.watcher = watch(this.opts.path, () => void this.drain());
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.watcher?.close();
    void this.handle?.close();
    this.handle = null;
  }

  private async drain(): Promise<void> {
    if (!this.handle) return;
    try {
      const st = await this.handle.stat();
      // Truncated or replaced file → restart from the beginning.
      if (this.inode !== null && BigInt(st.ino) !== this.inode) {
        this.inode = BigInt(st.ino);
        this.offset = 0;
        this.partial = "";
      } else if (st.size < this.offset) {
        this.offset = 0;
        this.partial = "";
      }
      if (st.size <= this.offset) return;

      const len = st.size - this.offset;
      const buf = Buffer.alloc(len);
      const { bytesRead } = await this.handle.read(buf, 0, len, this.offset);
      if (bytesRead <= 0) return;
      this.offset += bytesRead;

      this.partial += buf.subarray(0, bytesRead).toString("utf8");
      let idx: number;
      while ((idx = this.partial.indexOf("\n")) >= 0) {
        const line = this.partial.slice(0, idx).trimEnd();
        this.partial = this.partial.slice(idx + 1);
        if (line.length === 0) continue;
        let parsed: RawEvent | null | undefined;
        try {
          parsed = this.opts.parser(line, this.ctx());
        } catch {
          parsed = null;
        }
        if (parsed) this.onEvent(parsed);
      }
    } catch {
      // File may be mid-rotation; next watcher tick retries.
    }
  }

  private ctx(): TailContext {
    return {
      path: this.opts.path,
      agent_id: this.opts.agent_id,
      name: this.opts.name,
    };
  }

  onEvent: (event: RawEvent) => void = () => {};
}

export function defaultLogName(path: string): string {
  return basename(path);
}
