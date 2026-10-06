/**
 * Mock agent event generator — makes Agent Village run with zero real agents.
 *
 *   npm run mock                 scripted scenario (loops forever)
 *   npm run mock -- --chaos      random events, forever
 *   npm run mock -- --file x.json  replay an array of events, 400ms apart
 *   npm run mock -- --once        run the script once and exit
 *   npm run mock -- --url ws://host:port
 */

import { WebSocket } from "ws";
import { readFileSync } from "node:fs";

interface MockEvent {
  agent_id: string;
  name: string;
  type: string;
  detail?: string;
  file?: string;
  tool?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  duration_ms?: number;
  delayMs: number;
}

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const CHAOS = args.includes("--chaos");
const ONCE = args.includes("--once");
const URL = flag("--url") ?? "ws://localhost:8787";
const FILE = flag("--file");

const AGENTS = [
  { agent_id: "atlas", name: "Atlas", color: "#5aa9ff" },
  { agent_id: "brick", name: "Brick", color: "#ff8a3d" },
  { agent_id: "sentinel", name: "Sentinel", color: "#4fd67a" },
];

const FILES = [
  "src/core/renderer.ts",
  "src/world/grid.ts",
  "server/index.ts",
  "src/ui/hud.ts",
  "tests/grid.test.ts",
];

const TOOLS = ["shell", "git", "web", "mcp:github", "grep"];
const REASONING = [
  "Need the pathfinding grid to reserve cells, not just mark them blocked",
  "Brick tower height should map to write events per task, not lines",
  "Shadow camera must cover the whole village or edges look flat",
  "Replay scrubber needs snapshots every 5s or reducers get slow",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function e(partial: Partial<MockEvent> & { agent_id: string; type: string }, delayMs: number): MockEvent {
  return { name: partial.agent_id, delayMs, ...partial } as MockEvent;
}

function script(): MockEvent[] {
  const events: MockEvent[] = [];
  let t = 200;

  // Atlas: planner/orchestrator loop
  events.push(e({ agent_id: "atlas", type: "plan", detail: "Split village into ingest, world, HUD layers" }, t));
  t += 1400;
  events.push(e({ agent_id: "atlas", type: "read", file: "server/index.ts", detail: "reading ingest pipeline" }, t));
  t += 900;
  events.push(e({ agent_id: "atlas", type: "read", file: "src/world/grid.ts" }, t));
  t += 700;
  events.push(e({ agent_id: "atlas", type: "tool_call", tool: "grep", detail: "rg 'WebSocketServer'" }, t));
  t += 1200;
  events.push(e({ agent_id: "atlas", type: "write", file: pick(FILES), detail: "add reservation table to A*" }, t));
  t += 800;
  events.push(e({ agent_id: "atlas", type: "write", file: pick(FILES) }, t));
  t += 900;
  events.push(e({ agent_id: "atlas", type: "token_usage", tokens_in: 3100, tokens_out: 820, cost: 0.041 }, t));
  t += 600;

  // Brick: coder with a stumble
  events.push(e({ agent_id: "brick", type: "write", file: "src/ui/replayScrubber.ts", detail: "wire reducer snapshots" }, t));
  t += 1000;
  events.push(e({ agent_id: "brick", type: "tool_call", tool: "git", detail: "git diff --stat" }, t));
  t += 1100;
  events.push(e({ agent_id: "brick", type: "error", detail: "TypeError: cannot read 'length' of undefined" }, t));
  t += 1500;
  events.push(e({ agent_id: "brick", type: "approval", detail: "Allow npm install of new dep 'stats-lite'?" }, t));
  t += 2200;
  events.push(e({ agent_id: "brick", type: "tool_call", tool: "shell", detail: "npm install stats-lite" }, t));
  t += 1300;
  events.push(e({ agent_id: "brick", type: "write", file: pick(FILES) }, t));
  t += 700;
  events.push(e({ agent_id: "brick", type: "token_usage", tokens_in: 5400, tokens_out: 1900, cost: 0.088 }, t));
  t += 500;

  // Sentinel: tests
  events.push(e({ agent_id: "sentinel", type: "tool_call", tool: "shell", detail: "npm test", duration_ms: 4200 }, t));
  t += 4400;
  events.push(e({ agent_id: "sentinel", type: "test", detail: "34 passed", duration_ms: 4100 }, t));
  t += 1200;
  events.push(e({ agent_id: "sentinel", type: "tool_call", tool: "shell", detail: "npm test -- grid", duration_ms: 1800 }, t));
  t += 1900;
  events.push(e({ agent_id: "sentinel", type: "test", detail: "1 failed: A* cuts corner", duration_ms: 1750 }, t));
  t += 1500;
  events.push(e({ agent_id: "brick", type: "debug", detail: "breakpoint at grid.ts:142 — A* corner cut" }, t));
  t += 1600;
  events.push(e({ agent_id: "sentinel", type: "security_check", detail: "dependency audit: 0 critical CVEs" }, t));
  t += 1400;

  // Wrappers
  events.push(e({ agent_id: "atlas", type: "done", detail: "Phase 1 ingest + scene scaffold complete" }, t));
  t += 900;
  events.push(e({ agent_id: "brick", type: "done", detail: "Replay reducer + snapshots" }, t));
  t += 1400;
  events.push(e({ agent_id: "atlas", type: "ship", detail: "release v0.3.0 → production", duration_ms: 2400 }, t));
  t += 1800;

  return events;
}

const CHAOS_TYPES = [
  "plan", "read", "write", "tool_call", "test", "error", "approval", "done",
  "token_usage", "security_check", "debug", "ship", "mystery_ritual",
];

function chaosEvent(): MockEvent {
  const a = pick(AGENTS);
  const type = pick(CHAOS_TYPES);
  const ev: MockEvent = {
    agent_id: a.agent_id,
    name: a.name,
    type,
    delayMs: 80 + Math.random() * 700,
  };
  if (type === "read" || type === "write") ev.file = pick(FILES);
  if (type === "tool_call") {
    ev.tool = pick(TOOLS);
    ev.duration_ms = Math.round(200 + Math.random() * 3000);
  }
  if (type === "plan") ev.detail = pick(REASONING);
  if (type === "error") ev.detail = `boom: line ${Math.ceil(Math.random() * 900)}`;
  if (type === "approval") ev.detail = "Allow this action to continue?";
  if (type === "test") ev.detail = Math.random() > 0.35 ? "all green" : "1 failed";
  if (type === "ship") ev.detail = `release v0.${Math.ceil(Math.random() * 9)}.${Math.ceil(Math.random() * 9)} → production`;
  if (type === "security_check") ev.detail = Math.random() > 0.5 ? "dependency audit: clean" : "signing key rotated";
  if (type === "debug") ev.detail = `breakpoint hit at line ${Math.ceil(Math.random() * 600)}`;
  if (type === "token_usage") {
    ev.tokens_in = Math.round(500 + Math.random() * 6000);
    ev.tokens_out = Math.round(100 + Math.random() * 2000);
    ev.cost = Math.round(Math.random() * 12) / 100;
  }
  if (type === "done") ev.detail = pick(REASONING);
  return ev;
}

function connect(): { send: (ev: MockEvent) => void; close: () => void } {
  let ws: WebSocket | null = null;
  let queue: MockEvent[] = [];
  const pending: MockEvent[] = [];

  const open = () => {
    ws = new WebSocket(URL);
    ws.on("open", () => {
      console.log(`[mock] connected to ${URL}`);
      for (const ev of pending.splice(0)) send(ev);
    });
    ws.on("close", () => {
      console.log("[mock] disconnected, retrying in 1.5s…");
      ws = null;
      setTimeout(open, 1500);
    });
    ws.on("error", () => ws?.close());
  };

  function send(ev: MockEvent): void {
    const { delayMs, ...rest } = ev;
    const payload = { ...rest, timestamp: Date.now() };
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    else pending.push(ev);
  }

  open();
  return { send, close: () => ws?.close() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const client = connect();

  if (FILE) {
    const items = JSON.parse(readFileSync(FILE, "utf8")) as MockEvent[];
    console.log(`[mock] replaying ${items.length} events from ${FILE}`);
    for (const item of items) {
      client.send({ ...item, delayMs: 0 });
      await sleep(400);
    }
    return;
  }

  if (CHAOS) {
    console.log("[mock] chaos mode — random events forever");
    for (;;) {
      client.send(chaosEvent());
      await sleep(150 + Math.random() * 600);
    }
  }

  console.log("[mock] scripted scenario (3 agents), looping");
  do {
    let prev = 0;
    for (const ev of script()) {
      // ev.delayMs is the event's absolute scenario time — sleep the delta.
      await sleep(Math.max(0, ev.delayMs - prev));
      prev = ev.delayMs;
      client.send(ev);
    }
    if (ONCE) break;
    console.log("[mock] scenario loop restarts in 4s");
    await sleep(4000);
  } while (true);
}

main().catch((err) => {
  console.error("[mock] failed:", err);
  process.exit(1);
});
