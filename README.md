# Agent Village

An isometric 3D base — Clash of Clans style — that visualizes your AI agents
working in real time. Every building, animation and sound maps to a real agent
event. It's an observability tool disguised as a game.

> **Status: Phase 5 — agent states.** Every robot now runs an 8-state
> lifecycle (`idle → thinking → working → done`, plus `approval`, `error`,
> `stuck` and `crashed`) driven by events: a state beacon above its antenna
> glows in the state's color, and the name tag shows the live state under the
> name. Two `error` events within 8 seconds crash the robot (it slumps, drops
> its queue) until the next event revives it; unreachable doors enter a
> retrying `stuck` state. Remaining: HUD depth and polish.

## Quick start

```bash
npm install
npm run dev        # starts ingest server (:8787) + client (:5173)
npm run mock       # in another terminal: streams a scripted agent scenario
```

Open http://localhost:5173 — the chip in the bottom-left turns green when the
WebSocket connects, and shows the latest event as the mock scenario plays.

```bash
npm run mock -- --chaos    # random events forever
npm run mock -- --once     # one scripted pass, then exit
npm run typecheck          # tsc --noEmit
npm run test               # vitest (A* grid + village routing + agent states)
```

## What you see in-world

| Building | Events | Animation |
| --- | --- | --- |
| **Command Center** (center) | `plan`, `done` | roof screens flare with each plan/done |
| **Docs Archive** (NW) | `read` | a document card flies out onto the pile |
| **Dev Floor** (NE) | `write` | glowing code cubes launch and stack per task |
| **Ops Bench** (SW) | `tool_call` | CLI bots march out of the door and return |
| **QA Lab** (SE) | `test` | green flag on pass; scorch crater + crash orb on fail |
| **Compute Cluster** (N) | passive (`token_usage`) | data packets shower onto the heap |
| **Power & Billing** (N) | passive (`cost`) | battery level shows; meter needle spikes |
| **Release Wall** (N) | passive (`done`) | a version plaque lands on the board |
| **Incident Room** (W) | `error`, unknown types | red strobe, twitchy shudder, glowing runes |
| **NOC Monitors** (E) | ambient | gauges, status lights, cooling fans |
| **Security Gate** (SW) | `approval`, `security_check` | barrier arm raises; badge reader scans green→amber |
| **Debug Bay** (NE) | `debug` | breakpoints light up one by one; the bug gets squashed |
| **Ship Dock** (SE) | `ship` | a cargo container launches onto the stack |

The base is ringed by a **metal firewall** — instanced barrier blocks with
amber merlons and beacon masts on the corner towers — and the nav grid seals
at the wall line, so builders only move inside. Dark server-room tiles are
crossed by lit walkways that elbow around the Command Center to each door.

A robot builder per agent (max 12) spawns at the idle camp, pathfinds around
buildings with A* (string-pulled, 96×96 grid) to the target's door, hammers
there for the event's duration, then wanders the camp until the next event.
Builders separate so they never clip through each other, and each wears a
floating name tag in its own color.

### Agent states

| State | Trigger | Beacon |
| --- | --- | --- |
| `idle` | no tasks; wanders the camp | cyan, soft pulse |
| `thinking` | task enqueued; pathing to the door | violet, fast pulse |
| `working` | arrived at a building; hammering | teal |
| `approval` | arrived at the Security Gate | amber |
| `error` | arrived at the Incident Room | red strobe |
| `stuck` | A* found no path; retries every 2.2s | orange blink |
| `done` | task finished; brief cheer before idle | green flash |
| `crashed` | two `error` events within 8s; queue dropped | dark; revived by the next event |

The name tag shows the state in the beacon's color directly under the agent
name, so you can read the whole floor at a glance.

**Top bar:** TOKENS ← `tokens_in`+`tokens_out`, COST ← $ cost, SHIPPED ←
completed tasks, AGENTS ← busy/alive, plus the latest event ticker
(`agent → event`) and a connection chip.

## Sending your own events

```bash
curl -X POST http://localhost:8787/event \
  -H 'content-type: application/json' \
  -d '{"agent_id":"atlas","name":"Atlas","type":"write","file":"src/main.ts"}'
```

`POST /event` accepts a single event, an array of events, or `{ "events": [...] }`.
You can also send the same JSON over the WebSocket itself.

| Endpoint | Purpose |
| --- | --- |
| `POST /event` | Ingest one or many events → 202 + normalized events |
| `GET /health` | Clients connected, event count, uptime |
| `GET /events?since=<ms>&limit=<n>` | Backfill for late-joining HUDs / replay |
| `ws://localhost:8787` | Broadcast of every accepted event |

### Event schema

```json
{
  "agent_id": "atlas",
  "name": "Atlas",
  "type": "plan | read | write | tool_call | test | error | approval | security_check | debug | ship | done | token_usage",
  "detail": "free-form summary shown in bubbles and logs",
  "file": "src/world/grid.ts",
  "tool": "shell | git | web | mcp:...",
  "tokens_in": 3100,
  "tokens_out": 820,
  "cost": 0.041,
  "duration_ms": 4200,
  "timestamp": 1770000000000
}
```

Routing: `plan`/`done` → Command Center, `read` → Docs Archive, `write` →
Dev Floor, `tool_call` → Ops Bench, `test` → QA Lab, `approval`/
`security_check` → Security Gate, `debug` → Debug Bay, `ship` → Ship Dock,
`error` — and any unknown `type` — → Incident Room. `token_usage` is absorbed
passively by the Compute Cluster, `cost` by Power & Billing, and every `done`
also logs a plaque on the Release Wall. `timestamp` and `id` are filled in
server-side when missing.

## Ingesting real agent logs

Edit `village.config.json`:

```json
{
  "port": 8787,
  "logs": [
    { "path": "~/.codex/sessions/.../rollout-*.jsonl", "format": "codex", "agent_id": "codex", "name": "Codex" },
    { "path": "/var/log/my-agent.jsonl", "format": "jsonl", "agent_id": "my-agent", "name": "My Agent" },
    {
      "path": "/tmp/agent-stdout.log",
      "format": "rules",
      "agent_id": "cli-agent",
      "name": "CLI Agent",
      "rules": [
        { "pattern": "TOOL (?<tool>\\w+) (?<file>[\\w/.-]+)", "type": "tool_call", "tool": "$tool", "file": "$file" },
        { "pattern": "^(?<detail>.+)$", "type": "plan", "detail": "$detail" }
      ]
    }
  ]
}
```

- `codex` — Codex rollout JSONL (`~/.codex/sessions/**/rollout-*.jsonl`)
- `jsonl` — any line-delimited JSON; schema-shaped lines pass through untouched
- `rules` — ordered regex list; first match wins, `$1` / `$name` fill fields

Tails are rotation-safe (inode/truncation aware) and start at the end of the
file by default (`"startAt": "beginning"` to replay from the top).

## Project structure

```
server/            ingest server (node:http + ws, port 8787)
  index.ts         POST /event, GET /health, GET /events, WS broadcast
  events.ts        event schema + validation/normalization
  store.ts         10k ring buffer for late-join backfill
  adapters/        logTail (fs.watch tailer), codex, jsonl, rules
scripts/
  mock-events.ts   mock agent streamer (scripted / --chaos / --file)
src/
  main.ts          scene boot, lights, WS glue, dev debug hooks
  config.ts        WS url, iso camera angles, world bounds
  core/isoCamera.ts  orthographic iso camera (pan + zoom, no rotate)
  net/wsClient.ts  reconnecting WebSocket client
  ui/hud.ts        top bar (tokens/cost/shipped/agents + ticker)
  world/
    grid.ts        96×96 A* with string-pull smoothing + LOS helpers
    layout.ts      building specs, routes, wall ring, palette, camps
    terrain.ts     dark server-room floor, lit walkways, decor + footprint blocking
    buildings.ts   thirteen buildings, firewall + per-agent effects
    builder.ts     robot builder (8-state lifecycle, beacon, tags, separation)
    village.ts     event → building routing, counters, builder pool
tests/             vitest: A* guarantees + headless village scenarios
```

## Roadmap

1. ~~Structure + ingest + scene shell~~
2. ~~Five buildings (Town Hall, Library, Forge, Barracks, Archery Range)~~
3. ~~Animated builders with A* pathfinding + name tags + top-bar HUD~~
4. ~~Remaining buildings: Gold Mine, Elixir, Walls, Clock Tower, Trophy Hall, Mystery Hut~~
5. ~~IT re-theme: thirteen data-center buildings, new event types (`security_check` / `debug` / `ship`), tokens/cost/shipped HUD~~
6. ~~Agent states: idle/thinking/working/approval/stuck/error/done/crashed~~
7. HUD depth: agent side panel, toasts, minimap, replay scrubber
8. Polish: day/night cycle, tilt-shift DOF, procedural SFX, 50+ agent instancing
