import type { RawEvent } from "../events";
import type { LineParser, TailContext } from "./logTail";

/**
 * One regex rule: the first pattern that matches a log line becomes an event.
 * `$1`, `$2`… (numeric groups) and `$name` / named groups are substituted
 * into field values. Unmatched lines are ignored.
 */
export interface LogRule {
  pattern: string;
  type: string;
  tool?: string;
  file?: string;
  detail?: string;
}

export function compileRules(rules: LogRule[]): LineParser {
  const compiled = rules.map((r) => ({
    re: new RegExp(r.pattern),
    rule: r,
  }));

  return (line: string, ctx: TailContext): RawEvent | null => {
    for (const { re, rule } of compiled) {
      const m = re.exec(line);
      if (!m) continue;

      const fill = (template?: string): string | undefined => {
        if (template === undefined) return undefined;
        const out = template.replace(/\$(\d+|\w+)/g, (_, key: string) => {
          if (/^\d+$/.test(key)) return m[Number(key)] ?? "";
          return m.groups?.[key] ?? "";
        });
        return out.length > 0 ? out : undefined;
      };

      const out: RawEvent = {
        agent_id: ctx.agent_id,
        name: ctx.name,
        type: rule.type,
      };
      const detail = fill(rule.detail);
      if (detail) out.detail = detail;
      const tool = fill(rule.tool);
      if (tool) out.tool = tool;
      const file = fill(rule.file);
      if (file) out.file = file;
      return out;
    }
    return null;
  };
}
