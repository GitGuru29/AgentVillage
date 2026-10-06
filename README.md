# Agent Village

An isometric 3D base — Clash of Clans style — that visualizes your AI agents
working in real time. Every building, animation and sound maps to a real agent
event. It's an observability tool disguised as a game.

> **Status: structure milestone.** The ingest pipeline (WebSocket + HTTP + log
> tailers), the mock event streamer and the isometric scene shell are in.
> Buildings, animated builders, HUD, replay and day/night land in the next
> phases.

## Quick start

```bash
npm install
npm run dev        # starts ingest server (:8787) + client (:5173)
npm run mock       # in another terminal: streams a scripted agent scenario
```

Open http://localhost:5173 — the top-left chip turns green when the WebSocket
connects, and shows the latest event as the mock scenario plays.

```bash
npm run mock -- --chaos    # random events forever
npm run mock -- --once     # one scripted pass, then exit
npm run typecheck          # tsc --noEmit
npm run test               # vitest (no tests yet)
```

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
  "type": "plan | read | write | tool_call | test | error | approval | done | token_usage",
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

Unknown `type` values are accepted and routed to the **Mystery Hut** in-world.
`timestamp` and `id` are filled in server-side when missing.

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
  main.ts          scene boot, lights, ground, WS glue
  config.ts        WS url, iso camera angles, world bounds
  core/isoCamera.ts  orthographic iso camera (pan + zoom, no rotate)
  net/wsClient.ts  reconnecting WebSocket client
  world/ ui/ audio/  reserved: buildings, builders, HUD, SFX
tests/             vitest suites
```

## Roadmap

1. ~~Structure + ingest + scene shell~~ (this commit)
2. Five buildings (Town Hall, Library, Forge, Barracks, Archery Range)
3. Animated builders with A* pathfinding + name tags
4. Remaining buildings: Gold Mine, Elixir, Walls, Clock Tower, Trophy Hall, Mystery Hut
5. Agent states: idle/thinking/working/approval/stuck/error/done/crashed
6. HUD: top bar, agent side panel, toasts, minimap, replay scrubber
7. Polish: day/night cycle, tilt-shift DOF, procedural SFX, 50+ agent instancing
