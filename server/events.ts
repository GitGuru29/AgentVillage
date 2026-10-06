/**
 * Agent event schema shared by the ingest server, adapters and the client.
 *
 * { agent_id, name, type, detail, file?, tool?, tokens_in?, tokens_out?,
 *   cost?, duration_ms?, timestamp }
 *
 * Known types map to a building in the village. Unknown types are passed
 * through so the client can route them to the Incident Room.
 */

export const KNOWN_TYPES = [
  "plan",
  "read",
  "write",
  "tool_call",
  "test",
  "error",
  "approval",
  "done",
  "token_usage",
  "security_check",
  "debug",
  "ship",
] as const;

export type KnownAgentEventType = (typeof KNOWN_TYPES)[number];
export type AgentEventType = KnownAgentEventType | (string & {});

export interface AgentEvent {
  /** Monotonic id assigned by the server. */
  id: number;
  agent_id: string;
  name?: string;
  type: AgentEventType;
  detail?: string;
  file?: string;
  tool?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  duration_ms?: number;
  /** Event time in ms since epoch (caller-supplied or filled by server). */
  timestamp: number;
  /** Time the server received it — used for replay of late-joining clients. */
  received_at: number;
}

export type RawEvent = Record<string, unknown>;

export type NormalizeResult =
  | { ok: true; event: AgentEvent }
  | { ok: false; error: string };

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/** Validate + normalize one raw event. Never throws. */
export function normalizeEvent(raw: unknown, nextId: number, now: number): NormalizeResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "event must be a JSON object" };
  }
  const r = raw as RawEvent;

  const agentId = asString(r.agent_id);
  if (!agentId) return { ok: false, error: "agent_id (string) is required" };

  const type = asString(r.type);
  if (!type) return { ok: false, error: "type (string) is required" };

  const timestamp = asNumber(r.timestamp) ?? now;

  const event: AgentEvent = {
    id: nextId,
    agent_id: agentId,
    type,
    timestamp,
    received_at: now,
  };
  const name = asString(r.name);
  if (name !== undefined) event.name = name;
  const detail = asString(r.detail);
  if (detail !== undefined) event.detail = detail;
  const file = asString(r.file);
  if (file !== undefined) event.file = file;
  const tool = asString(r.tool);
  if (tool !== undefined) event.tool = tool;
  for (const key of ["tokens_in", "tokens_out", "duration_ms"] as const) {
    const n = asNumber(r[key]);
    if (n !== undefined) event[key] = n;
  }
  const cost = asNumber(r.cost);
  if (cost !== undefined) event.cost = cost;

  return { ok: true, event };
}
