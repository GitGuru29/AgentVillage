import type { RawEvent } from "../events";
import type { LineParser, TailContext } from "./logTail";

const TYPE_KEYS = ["event", "eventType", "kind", "msg_type", "event_type"];
const DETAIL_KEYS = ["message", "detail", "content", "text", "summary", "msg"];

function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Generic JSONL passthrough: any agent writing line-delimited JSON.
 * Lines that already match the village schema pass through untouched;
 * other JSON shapes are mapped best-effort (unknown → Incident Room).
 */
export function jsonlParser(line: string, ctx: TailContext): RawEvent | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;

  const hasSchema =
    typeof o.agent_id === "string" && typeof o.type === "string" && !Array.isArray(o);
  if (hasSchema) {
    return {
      agent_id: o.agent_id,
      name: o.name ?? ctx.name,
      ...o,
    };
  }

  const type = pick(o, TYPE_KEYS);
  if (!type) return null;

  const out: RawEvent = { agent_id: ctx.agent_id, name: ctx.name, type };
  const detail = pick(o, DETAIL_KEYS);
  if (detail) out.detail = detail;
  for (const key of ["file", "tool"] as const) {
    const v = o[key];
    if (typeof v === "string") out[key] = v;
  }
  for (const key of ["tokens_in", "tokens_out", "cost", "duration_ms"] as const) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  const ts = o.timestamp ?? o.ts ?? o.time;
  if (typeof ts === "number") out.timestamp = ts;
  return out;
}
