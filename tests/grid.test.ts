import { describe, expect, it } from "vitest";
import { NavGrid } from "../src/world/grid";

describe("NavGrid A*", () => {
  it("walks a straight line on open ground", () => {
    const g = new NavGrid(32);
    const path = g.findPath({ x: -10, z: 0 }, { x: 10, z: 0 });
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(1);
    expect(path![0]!.x).toBeCloseTo(10, 5);
    expect(path![0]!.z).toBeCloseTo(0, 5);
  });

  it("routes around a blocked wall", () => {
    const g = new NavGrid(32);
    g.blockRect({ x0: -1, z0: -10, x1: 1, z1: 10 });
    const path = g.findPath({ x: -8, z: 0 }, { x: 8, z: 0 });
    expect(path).not.toBeNull();
    for (const p of path!) {
      expect(g.isBlockedWorld(p.x, p.z)).toBe(false);
    }
    // must have detoured around the wall ends (|z| > 10 eventually)
    expect(Math.max(...path!.map((p) => Math.abs(p.z)))).toBeGreaterThan(9);
  });

  it("never cuts corners through blocked diagonals", () => {
    const g = new NavGrid(32);
    // Two blocked cells forming a diagonal pinch.
    g.blockRect({ x0: 0, z0: -3, x1: 2, z1: 0 });
    g.blockRect({ x0: -2, z0: 0, x1: 0, z1: 3 });
    const path = g.findPath({ x: -5, z: -3 }, { x: 5, z: 3 });
    if (path) {
      for (const p of path) expect(g.isBlockedWorld(p.x, p.z)).toBe(false);
    }
  });

  it("returns null when unreachable", () => {
    const g = new NavGrid(32);
    // Full-height wall splits the map in two.
    g.blockRect({ x0: -1, z0: -16, x1: 1, z1: 16 });
    const path = g.findPath({ x: -8, z: 0 }, { x: 8, z: 0 });
    expect(path).toBeNull();
  });

  it("snaps start/goal out of blocked cells", () => {
    const g = new NavGrid(32);
    g.blockRect({ x0: -2, z0: -2, x1: 2, z1: 2 });
    const path = g.findPath({ x: 0, z: 0 }, { x: 10, z: 0 });
    expect(path).not.toBeNull();
    expect(g.isBlockedWorld(path!.at(-1)!.x, path!.at(-1)!.z)).toBe(false);
  });

  it("smoothed path never crosses blocked cells", () => {
    const g = new NavGrid(64);
    for (let i = -20; i <= 20; i += 5) {
      g.blockRect({ x0: i, z0: -8, x1: i + 2, z1: 8 });
    }
    const path = g.findPath({ x: -25, z: -25 }, { x: 25, z: 25 });
    expect(path).not.toBeNull();
    let prev = { x: -25, z: -25 };
    for (const p of path!) {
      expect(g.lineFree(prev.x, prev.z, p.x, p.z)).toBe(true);
      prev = p;
    }
  });

  it("blocks building footprints and still paths around them", () => {
    const g = new NavGrid(96);
    g.blockRect({ x0: -4, z0: -4, x1: 4, z1: 4 });
    g.blockRect({ x0: -20, z0: -8, x1: -14, z1: -3 });
    const path = g.findPath({ x: -10, z: 4 }, { x: -17, z: -2 });
    expect(path).not.toBeNull();
    for (const p of path!) expect(g.isBlockedWorld(p.x, p.z)).toBe(false);
  });
});
