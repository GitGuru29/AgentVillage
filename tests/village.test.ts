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
    expect(buildingForType("plan")).toBe("command");
    expect(buildingForType("done")).toBe("command");
    expect(buildingForType("read")).toBe("docs");
    expect(buildingForType("write")).toBe("devfloor");
    expect(buildingForType("tool_call")).toBe("ops");
    expect(buildingForType("test")).toBe("qa");
    expect(buildingForType("approval")).toBe("gate");
    expect(buildingForType("security_check")).toBe("gate");
    expect(buildingForType("debug")).toBe("debug");
    expect(buildingForType("ship")).toBe("dock");
  });

  it("routes odd types to the Incident Room, passive ones nowhere", () => {
    expect(buildingForType("mystery_ritual")).toBe("incident");
    expect(buildingForType("error")).toBe("incident");
    expect(buildingForType("token_usage")).toBeNull(); // racks react passively
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
    { agent_id: "sentinel", type: "security_check", detail: "audit clean" },
    { agent_id: "brick", type: "debug", detail: "breakpoint hit" },
    {
      agent_id: "atlas",
      type: "token_usage",
      tokens_in: 3000,
      tokens_out: 500,
      cost: 0.042,
    },
    { agent_id: "brick", type: "done", detail: "shipped" },
    { agent_id: "atlas", type: "ship", detail: "release v0.3.0" },
    { agent_id: "ghost", type: "unseen_ritual" },
  ];

  it("processes a full scenario and keeps counters right", () => {
    const scene = new Scene();
    const village = new Village(scene);
    const snapshots: Counters[] = [];
    village.onCounters = (c) => snapshots.push(c);

    for (const e of scenario) village.handleEvent(e);
    for (let i = 0; i < 900; i++) village.update(1 / 60);

    expect(village.counters.tokens).toBe(3500);
    expect(village.counters.cost).toBeCloseTo(0.042, 5);
    expect(village.counters.shipped).toBe(1);
    expect(village.counters.total).toBe(4); // ghost → Incident Room
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

  it("unknown events send a builder to the Incident Room", () => {
    const village = new Village(new Scene());
    village.handleEvent({ agent_id: "weird", type: "sacrifice", detail: "???" });
    expect(village.counters.total).toBe(1);
    for (let i = 0; i < 1800; i++) village.update(1 / 60);
    expect(village.counters.active).toBe(0);
  });

  it("agents reach the gate, debug bay and dock", () => {
    const village = new Village(new Scene());
    village.handleEvent({ agent_id: "g1", type: "security_check", detail: "audit" });
    village.handleEvent({ agent_id: "d1", type: "debug", detail: "breakpoint" });
    village.handleEvent({ agent_id: "s1", type: "ship", detail: "v0.3.0" });
    expect(village.counters.total).toBe(3);
    for (let i = 0; i < 3600; i++) village.update(1 / 60); // 60s
    expect(village.counters.active).toBe(0); // all three finished
  });
});

describe("Phase 4 world", () => {
  it("every building is constructed with its hooks", () => {
    const village = new Village(new Scene());
    const { buildings } = village;
    expect(buildings.command.pulse).toBeTypeOf("function");
    expect(buildings.docs.spawnDoc).toBeTypeOf("function");
    expect(buildings.devfloor.pushCode).toBeTypeOf("function");
    expect(buildings.ops.runTool).toBeTypeOf("function");
    expect(buildings.qa.testResult).toBeTypeOf("function");
    expect(buildings.racks.rackLoad).toBeTypeOf("function");
    expect(buildings.power.meterSpike).toBeTypeOf("function");
    expect(buildings.release.logRelease).toBeTypeOf("function");
    expect(buildings.incident.pulse).toBeTypeOf("function");
    expect(buildings.gate.scanBadge).toBeTypeOf("function");
    expect(buildings.debug.debugBreak).toBeTypeOf("function");
    expect(buildings.dock.launchCargo).toBeTypeOf("function");
    expect(buildings.noc.group.name).toBe("noc");
    expect(Object.keys(buildings)).toHaveLength(13);
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
    expect(grid.isBlockedWorld(-9.5, -15.5)).toBe(true); // racks footprint
    expect(grid.isBlockedWorld(9.5, -15.5)).toBe(true); // power footprint
    expect(grid.isBlockedWorld(-20.5, 2)).toBe(true); // incident footprint
    expect(grid.isBlockedWorld(20.5, 2)).toBe(true); // noc footprint
    expect(grid.isBlockedWorld(-19.5, 12.5)).toBe(true); // gate footprint
    expect(grid.isBlockedWorld(18.5, -13)).toBe(true); // debug footprint
    expect(grid.isBlockedWorld(20, 12)).toBe(true); // dock footprint
  });

  it("every walkway stays inside the walls and off other buildings", () => {
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
