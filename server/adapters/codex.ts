import type { RawEvent } from "../events";
import type { LineParser, TailContext } from "./logTail";

/**
 * Codex rollout JSONL adapter — maps `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
 * records (shape: { timestamp, ordinal, type, payload }) to village events.
 * Meta/telemetry record types are skipped so the Incident Room only lights up
 * for genuinely unknown *event* types.
 */

const SKIP_TYPES = new Set([
  "session_meta",
  "update",
  "special",
  "message",
  "text",
  "output_text",
  "input_text",
  "summary_text",
  "unknown",
]);

const TOOL_TYPES = new Set([
  "function_call",
  "custom_tool_call",
  "local_shell_call",
  "shell",
]);

const TOOL_OUTPUT_TYPES = new Set([
  "function_call_output",
  "custom_tool_call_output",
  "local_shell_call_output",
  "command_execution",
]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function text(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v)) {
    const parts = v.map((x) => text(x)).filter((x): x is string => !!x);
    if (parts.length > 0) return parts.join(" ");
  }
  const rec = asRecord(v);
  if (rec) {
    for (const key of ["text", "content", "summary", "name"]) {
      const t = text(rec[key]);
      if (t) return t;
    }
  }
  return undefined;
}

function findNumber(v: unknown, keys: string[]): number | undefined {
  const rec = asRecord(v);
  if (!rec) return undefined;
  for (const k of keys) {
    const n = rec[k];
    if (typeof n === "number" && Number.isFinite(n)) return n;
    const nested = asRecord(n);
    if (nested) {
      const inner = findNumber(nested, keys);
      if (inner !== undefined) return inner;
    }
  }
  return undefined;
}

export const codexParser: LineParser = (line: string, ctx: TailContext): RawEvent | null => {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  const rec = asRecord(obj);
  if (!rec) return null;

  const topType = typeof rec.type === "string" ? rec.type : null;
  if (!topType || SKIP_TYPES.has(topType)) return null;

  const payload = asRecord(rec.payload) ?? {};
  const innerType =
    typeof payload.type === "string" ? payload.type : topType;

  const ts =
    typeof rec.timestamp === "string"
      ? Date.parse(rec.timestamp)
      : typeof rec.timestamp === "number"
        ? rec.timestamp
        : undefined;

  const base: RawEvent = { agent_id: ctx.agent_id, name: ctx.name };
  if (ts !== undefined && Number.isFinite(ts)) base.timestamp = ts;

  if (innerType === "error" || payload.status === "error") {
    return {
      ...base,
      type: "error",
      detail: text(payload) ?? text(payload.message) ?? innerType,
    };
  }

  if (TOOL_TYPES.has(innerType)) {
    const tool = text(payload.name) ?? text(payload.tool) ?? innerType;
    const detail = text(payload.arguments) ?? text(payload.input);
    return { ...base, type: "tool_call", tool, ...(detail ? { detail } : {}) };
  }

  if (TOOL_OUTPUT_TYPES.has(innerType)) return null;

  if (innerType === "reasoning") {
    const detail = text(payload.summary) ?? text(payload.content);
    return { ...base, type: "plan", ...(detail ? { detail } : {}) };
  }

  if (innerType === "file_change" || innerType === "apply_patch" || innerType === "patch") {
    const file = text(payload.path) ?? text(payload.file);
    return { ...base, type: "write", ...(file ? { file } : {}) };
  }

  if (innerType === "read" || innerType === "file_search" || innerType === "view") {
    const file = text(payload.path) ?? text(payload.file) ?? text(payload.query);
    return { ...base, type: "read", ...(file ? { file } : {}) };
  }

  if (topType === "token_count" || topType === "token_usage_record" || innerType === "token_usage") {
    const src = Object.keys(payload).length > 0 ? payload : rec;
    const tokensIn =
      findNumber(src, ["input_tokens", "prompt_tokens", "tokens_in"]) ?? 0;
    const tokensOut =
      findNumber(src, ["output_tokens", "completion_tokens", "tokens_out"]) ?? 0;
    if (tokensIn === 0 && tokensOut === 0) return null;
    return { ...base, type: "token_usage", tokens_in: tokensIn, tokens_out: tokensOut };
  }

  // Unmapped record → let the Incident Room handle it.
  return { ...base, type: `codex:${innerType}`, detail: text(payload) };
};
