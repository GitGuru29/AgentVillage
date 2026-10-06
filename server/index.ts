import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { normalizeEvent, type AgentEvent } from "./events";
import { EventStore } from "./store";
import { LogTailer, type LineParser } from "./adapters/logTail";
import { jsonlParser } from "./adapters/jsonl";
import { codexParser } from "./adapters/codex";
import { compileRules, type LogRule } from "./adapters/rules";

interface LogSourceConfig {
  path: string;
  format: "jsonl" | "codex" | "rules";
  agent_id: string;
  name?: string;
  rules?: LogRule[];
  startAt?: "end" | "beginning";
}

interface VillageConfig {
  port: number;
  logs: LogSourceConfig[];
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function loadConfig(): VillageConfig {
  const file = join(ROOT, "village.config.json");
  if (!existsSync(file)) return { port: 8787, logs: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<VillageConfig>;
    return { port: raw.port ?? 8787, logs: raw.logs ?? [] };
  } catch (err) {
    console.warn("[village] failed to parse village.config.json:", err);
    return { port: 8787, logs: [] };
  }
}

const config = loadConfig();
const store = new EventStore(10_000);
const clients = new Set<WebSocket>();

function broadcast(event: AgentEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function accept(raw: unknown): { event?: AgentEvent; error?: string } {
  const result = normalizeEvent(raw, store.nextEventId(), Date.now());
  if (!result.ok) return { error: result.error };
  store.push(result.event);
  broadcast(result.event);
  return { event: result.event };
}

function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        clients: clients.size,
        events: store.size(),
        latest_id: store.latest()?.id ?? null,
        uptime_s: Math.round(process.uptime()),
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(store.since(since, limit)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/event") {
    void (async () => {
      try {
        const body = await readBody(req);
        const parsed: unknown = JSON.parse(body);
        const items = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === "object" && Array.isArray((parsed as { events?: unknown }).events)
            ? (parsed as { events: unknown[] }).events
            : [parsed];

        const events: AgentEvent[] = [];
        const errors: string[] = [];
        for (const item of items) {
          const { event, error } = accept(item);
          if (event) events.push(event);
          else errors.push(error ?? "invalid event");
        }
        res.writeHead(events.length > 0 ? 202 : 400, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({ accepted: events.length, events, errors }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "bad request" }));
      }
    })();
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log(`[village] client connected (${clients.size} total)`);
  ws.on("close", () => {
    clients.delete(ws);
    console.log(`[village] client left (${clients.size} total)`);
  });
  ws.on("error", () => clients.delete(ws));
  ws.on("message", (data) => {
    // Clients may also push events over the socket, same schema as POST /event.
    try {
      const parsed: unknown = JSON.parse(data.toString());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) accept(item);
    } catch {
      /* ignore malformed frames */
    }
  });
});

function parserFor(src: LogSourceConfig): LineParser | null {
  switch (src.format) {
    case "codex":
      return codexParser;
    case "rules":
      return src.rules ? compileRules(src.rules) : null;
    case "jsonl":
      return jsonlParser;
    default:
      return null;
  }
}

const tailers: LogTailer[] = [];
for (const src of config.logs) {
  const parser = parserFor(src);
  if (!parser) {
    console.warn(`[village] no parser for log source ${src.path} (format=${src.format})`);
    continue;
  }
  const tailer = new LogTailer({
    path: src.path,
    agent_id: src.agent_id,
    name: src.name ?? src.agent_id,
    parser,
    startAt: src.startAt ?? "end",
  });
  tailer.onEvent = (ev) => accept(ev);
  void tailer.start();
  tailers.push(tailer);
}

server.listen(config.port, () => {
  console.log(`[village] ingest server on http://localhost:${config.port}`);
  console.log(`[village] websocket on ws://localhost:${config.port}`);
  console.log(`[village] log sources: ${config.logs.length}`);
});

process.on("SIGINT", () => {
  for (const t of tailers) t.stop();
  wss.close();
  server.close(() => process.exit(0));
});
