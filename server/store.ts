import type { AgentEvent } from "./events";

/**
 * Bounded ring buffer of accepted events. Keeps late-joining HUD clients
 * able to backfill (GET /events?since=) and feeds the replay scrubber.
 */
export class EventStore {
  private buf: AgentEvent[] = [];
  private nextId = 1;

  constructor(private capacity = 10_000) {}

  nextEventId(): number {
    return this.nextId++;
  }

  push(event: AgentEvent): void {
    this.buf.push(event);
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }

  /** Events with received_at strictly after `sinceMs`, capped at `limit`. */
  since(sinceMs: number, limit = 1000): AgentEvent[] {
    const out: AgentEvent[] = [];
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const e = this.buf[i]!;
      if (e.received_at <= sinceMs) break;
      out.push(e);
    }
    return out.reverse().slice(-limit);
  }

  size(): number {
    return this.buf.length;
  }

  latest(): AgentEvent | undefined {
    return this.buf[this.buf.length - 1];
  }
}
