import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { buildingForType, testPassed, Village, type Counters } from "../src/world/village";

describe("event → building mapping", () => {
  it("routes every known type to its building", () => {
    expect(buildingForType("plan")).toBe("townHall");
    expect(buildingForType("done")).toBe("townHall");
    expect(buildingForType("read")).toBe("library");
    expect(buildingForType("write")).toBe("forge");
    expect(buildingForType("tool_call")).toBe("barracks");
    expect(buildingForType("test")).toBe("archery");
  });

  it("sends unknown types nowhere (Mystery Hut comes later)", () => {
    expect(buildingForType("mystery_ritual")).toBeNull();
    expect(buildingForType("")).toBeNull();
  });
});

describe("test pass/fail detection", () => {
  it("passes by default and on green details", () => {
    expect(testPassed(undefined)).toBe(true);
    expect(testPassed("34 passed")).toBe(true);
    expect(testPassed("all green")).toBe(true);
  });

  it("fails on failure details", () => {
    expect(testPassed("1 failed: A* cuts corner")).toBe(false);
    expect(testPassed("FAILURE")).toBe(false);
    expect(testPassed("error: timeout")).toBe(false);
  });
});

describe("Village (headless)", () => {
  const scenario = [
    { agent_id: "atlas", name: "Atlas", type: "plan", detail: "split the work" },
    { agent_id: "atlas", type: "read", file: "src/main.ts" },
    { agent_id: "brick", name: "Brick", type: "write", file: "src/ui/hud.ts" },
    { agent_id: "brick", type: "write", file: "src/net/ws.ts" },
    { agent_id: "sentinel", type: "tool_call", tool: "shell", duration_ms: 3000 },
    { agent_id: "sentinel", type: "test", detail: "34 passed" },
    { agent_id: "sentinel", type: "test", detail: "1 failed: corner cut" },
    {
      agent_id: "atlas",
      type: "token_usage",
      tokens_in: 3000,
      tokens_out: 500,
      cost: 0.042,
    },
    { agent_id: "brick", type: "done", detail: "shipped" },
    { agent_id: "ghost", type: "unseen_ritual" },
  ];

  it("processes a full scenario and keeps counters right", () => {
    const scene = new Scene();
    const village = new Village(scene);
    const snapshots: Counters[] = [];
    village.onCounters = (c) => snapshots.push(c);

    for (const e of scenario) village.handleEvent(e);
    for (let i = 0; i < 900; i++) village.update(1 / 60);

    expect(village.counters.gold).toBe(3500);
    expect(village.counters.elixir).toBeCloseTo(0.042, 5);
    expect(village.counters.trophies).toBe(1);
    expect(village.counters.total).toBe(3); // ghost has no building → no builder
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("ignores malformed events", () => {
    const village = new Village(new Scene());
    for (const bad of [null, 42, "hi", {}, { agent_id: "x" }, { type: "plan" }]) {
      expect(() => village.handleEvent(bad)).not.toThrow();
    }
    expect(village.counters.total).toBe(0);
  });

  it("agents reach their buildings and finish the queue", () => {
    const scene = new Scene();
    const village = new Village(scene);
    village.handleEvent({ agent_id: "solo", type: "write", file: "a.ts" });
    for (let i = 0; i < 1800; i++) village.update(1 / 60); // 30s
    expect(village.counters.active).toBe(0); // task done → idle again
  });
});
