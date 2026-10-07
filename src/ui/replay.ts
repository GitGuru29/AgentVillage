/**
 * Session recording + time machine for the Phase 6 scrubber.
 *
 * The engine owns the event tape and the mode switch:
 *
 *   live    events flow straight into the Village (FX + builders), recorded
 *           as they arrive
 *   replay  the tape is rebuilt quietly up to `replayTime` (counters, error
 *           storms and one trimmed task per agent), the clock is paused or
 *           playing at `speed`, and fed events run with FX again — catching
 *           up to wall-clock flips back to live automatically
 *
 * DOM-free on purpose: the scrubber/toasts/panel are thin views over it.
 */

import { Village } from "../world/village";

export interface TapeEntry {
  /** absolute ms (received_at) */
  t: number;
  e: Record<string, unknown>;
}

export interface AgentStats {
  name: string;
  events: number;
  tokens: number;
  cost: number;
  shipped: number;
  lastType: string;
  lastAt: number;
}

export interface ToastSpec {
  color: string;
  title: string;
  detail?: string;
  ms?: number;
}

export type ReplayMode = "live" | "replay";

const TAPE_CAP = 5000;

/** What the HUD/timeline wants to hear about. Returns null for quiet events. */
export function toastFor(e: Record<string, unknown>): ToastSpec | null {
  const type = typeof e.type === "string" ? e.type : "";
  const name = (typeof e.name === "string" && e.name) ||
    (typeof e.agent_id === "string" ? e.agent_id : "?");
  const detail = typeof e.detail === "string" ? e.detail : undefined;
  switch (type) {
    case "error":
      return { color: "#e05252", title: `${name} → error`, detail };
    case "approval":
      return { color: "#ffb84d", title: `${name} needs approval`, detail };
    case "security_check":
      return { color: "#ffb84d", title: `${name} → security check`, detail };
    case "ship":
      return { color: "#4fd67a", title: `${name} shipped`, detail };
    case "test":
      if (detail && /\b(fail(ed|ure)?|✗|error|broken)\b/i.test(detail)) {
        return { color: "#d0342c", title: `${name} → test failed`, detail };
      }
      return null;
    default:
      return null;
  }
}

export class ReplayEngine {
  mode: ReplayMode = "live";
  paused = false;
  speed = 1;
  /** Absolute ms of the playhead while in replay mode. */
  replayTime = 0;

  readonly stats = new Map<string, AgentStats>();
  onToast?: (t: ToastSpec) => void;
  onChange?: () => void;

  private tape: TapeEntry[] = [];
  private t0 = 0;
  private fedThrough = 0;

  constructor(
    private village: Village,
    private now: () => number = Date.now,
  ) {
    village.onCrash = (agentId, fallback) => {
      const name = this.stats.get(agentId)?.name ?? fallback;
      this.onToast?.({
        color: "#3d1620",
        title: `${name} crashed`,
        detail: "error storm — two errors inside 8s",
        ms: 6500,
      });
    };
  }

  get firstT(): number {
    return this.t0;
  }

  get lastT(): number {
    return this.tape.length > 0 ? this.tape[this.tape.length - 1]!.t : this.t0;
  }

  get recorded(): readonly TapeEntry[] {
    return this.tape;
  }

  /** Ingest one live event: record + stats (+ feed the world when live). */
  ingest(raw: unknown): void {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const e = raw as Record<string, unknown>;
    const t =
      typeof e.received_at === "number" && Number.isFinite(e.received_at)
        ? e.received_at
        : this.now();
    if (this.tape.length === 0) this.t0 = t;
    this.tape.push({ t, e });
    if (this.tape.length > TAPE_CAP) this.tape.splice(0, this.tape.length - TAPE_CAP);
    this.trackStats(e, t);

    if (this.mode === "live") {
      // same clock as rebuild/playback so the error-storm window is uniform
      this.village.handleEvent(e, { now: t / 1000 });
      const toast = toastFor(e);
      if (toast) this.onToast?.(toast);
    }
    this.onChange?.();
  }

  /** Advance replay playback; returns to live once the playhead catches up. */
  tick(dt: number): void {
    if (this.mode !== "replay" || this.paused) return;
    const now = this.now();
    this.replayTime = Math.min(this.replayTime + dt * 1000 * this.speed, now);
    this.feed(this.replayTime);
    this.onChange?.();
    if (this.replayTime >= now - 50) this.goLive();
  }

  /** Jump the playhead to an absolute ms on the tape and rebuild the world. */
  seek(t: number): void {
    const target = Math.max(this.t0, Math.min(t, this.now()));
    this.mode = "replay";
    this.paused = true;
    this.replayTime = target;
    this.rebuild(target);
    this.onChange?.();
  }

  play(): void {
    if (this.mode === "live") this.seek(this.now());
    this.paused = false;
    this.onChange?.();
  }

  pause(): void {
    if (this.mode === "live") this.seek(this.now());
    else this.paused = true;
    this.onChange?.();
  }

  cycleSpeed(): void {
    this.speed = this.speed === 1 ? 4 : this.speed === 4 ? 16 : 1;
    this.onChange?.();
  }

  /** Rewind to the wall clock and resume normal event flow. */
  goLive(): void {
    if (this.mode === "live" && !this.paused) return;
    this.mode = "live";
    this.paused = false;
    this.speed = 1;
    this.rebuild(this.now());
    this.village.replayPacing = false;
    this.onChange?.();
  }

  /** Counters the tape implies at time t (mirrors Village.handleEvent rules). */
  countersAt(t: number): { tokens: number; cost: number; shipped: number } {
    let tokens = 0;
    let cost = 0;
    let shipped = 0;
    for (const { t: et, e } of this.tape) {
      if (et > t) break;
      const type = typeof e.type === "string" ? e.type : "";
      if (type === "token_usage") {
        tokens += pos(e.tokens_in) + pos(e.tokens_out);
      }
      cost += pos(e.cost);
      if (type === "done") shipped += 1;
    }
    return { tokens, cost, shipped };
  }

  /** Rebuild the world up to `t`, quietly (no FX) with trimmed task queues. */
  private rebuild(t: number): void {
    this.village.replayPacing = true;
    this.village.beginReplay();
    for (const { t: et, e } of this.tape) {
      if (et > t) break;
      this.village.handleEvent(e, { fx: false, now: et / 1000 });
    }
    this.fedThrough = t;
  }

  /** Feed tape entries in (fedThrough, until] — full FX during playback. */
  private feed(until: number): void {
    for (const { t, e } of this.tape) {
      if (t <= this.fedThrough) continue;
      if (t > until) break;
      this.village.handleEvent(e, { now: t / 1000 });
      this.fedThrough = t;
    }
  }

  private trackStats(e: Record<string, unknown>, t: number): void {
    const id = typeof e.agent_id === "string" ? e.agent_id : null;
    if (!id) return;
    const name = (typeof e.name === "string" && e.name) || id;
    let s = this.stats.get(id);
    if (!s) {
      s = { name, events: 0, tokens: 0, cost: 0, shipped: 0, lastType: "", lastAt: t };
      this.stats.set(id, s);
    }
    if (typeof e.name === "string" && e.name) s.name = e.name;
    s.events += 1;
    s.tokens += pos(e.tokens_in) + pos(e.tokens_out);
    s.cost += pos(e.cost);
    if (e.type === "done") s.shipped += 1;
    s.lastType = typeof e.type === "string" ? e.type : s.lastType;
    s.lastAt = t;
  }
}

function pos(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
