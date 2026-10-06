import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { BUILDINGS, insideWall, pathSegments } from "../src/world/layout";
import { buildingForType, testPassed, Village, type Counters } from "../src/world/village";

function pathFootprints() {
  return BUILDINGS.map((b) => ({
    x0: b.x - b.w / 2,
    z0: b.z - b.d / 2,
    x1: b.x + b.w / 2,
    z1: b.z + b.d / 2,
  }));
}

describe("event → building mapping", () => {
  it("routes every known type to its building", () => {
    expect(buildingForType("plan")).toBe("townHall");
    expect(buildingForType("done")).toBe("townHall");
    expect(buildingForType("read")).toBe("library");
    expect(buildingForType("write")).toBe("forge");
    expect(buildingForType("tool_call")).toBe("barracks");
    expect(buildingForType("test")).toBe("archery");
  });

  it("routes odd types to the Mystery Hut, passive ones nowhere", () => {
    expect(buildingForType("mystery_ritual")).toBe("mystery");
    expect(buildingForType("error")).toBe("mystery");
    expect(buildingForType("approval")).toBe("mystery");
    expect(buildingForType("token_usage")).toBeNull(); // gold mine reacts passively
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
    expect(village.counters.total).toBe(4); // ghost → Mystery Hut
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

  it("unknown events send a builder to the Mystery Hut", () => {
    const village = new Village(new Scene());
    village.handleEvent({ agent_id: "weird", type: "sacrifice", detail: "???" });
    expect(village.counters.total).toBe(1);
    for (let i = 0; i < 1800; i++) village.update(1 / 60);
    expect(village.counters.active).toBe(0);
  });
});

describe("Phase 3 world", () => {
  it("every building is constructed with its hooks", () => {
    const village = new Village(new Scene());
    const { buildings } = village;
    expect(buildings.goldMine.mineGold).toBeTypeOf("function");
    expect(buildings.elixir.collect).toBeTypeOf("function");
    expect(buildings.trophyHall.addTrophy).toBeTypeOf("function");
    expect(buildings.mystery.pulse).toBeTypeOf("function");
    expect(buildings.clockTower.group.name).toBe("clockTower");
    expect(Object.keys(buildings)).toHaveLength(10);
  });

  it("walls seal the perimeter but the village stays walkable", () => {
    const { grid } = new Village(new Scene());
    expect(grid.isBlockedWorld(0, -20)).toBe(true); // north wall
    expect(grid.isBlockedWorld(24, 0)).toBe(true); // east wall
    expect(grid.isBlockedWorld(-24, 0)).toBe(true); // west wall
    expect(grid.isBlockedWorld(0, 20)).toBe(true); // south wall
    expect(grid.isBlockedWorld(21, -17)).toBe(true); // NE chamfer
    expect(grid.isBlockedWorld(0, 7.5)).toBe(false); // plaza
    expect(grid.isBlockedWorld(0, 11)).toBe(false); // idle camp
    expect(grid.isBlockedWorld(-9.5, -15.5)).toBe(true); // gold mine footprint
    expect(grid.isBlockedWorld(9.5, -15.5)).toBe(true); // elixir footprint
    expect(grid.isBlockedWorld(-20.5, 2)).toBe(true); // mystery footprint
    expect(grid.isBlockedWorld(20.5, 2)).toBe(true); // clock footprint
  });

  it("every dirt path stays inside the walls and off other buildings", () => {
    const footprints = pathFootprints();
    for (const [[ax, az], [bx, bz]] of pathSegments()) {
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.4);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const where = `(${ax},${az})→(${bx},${bz}) at (${x.toFixed(1)},${z.toFixed(1)})`;
        expect(insideWall(x, z, -0.7), `path leaks past the wall: ${where}`).toBe(true);
        const nearOwnDoor = Math.hypot(x - ax, z - az) <= 4;
        if (nearOwnDoor) continue;
        for (const f of footprints) {
          const inside =
            x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
          expect(inside, `footprint crossed: ${where}`).toBe(false);
        }
      }
    }
  });
});
