import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { ReplayEngine, toastFor } from "../src/ui/replay";
import { Village } from "../src/world/village";

/** Fake wall clock the engine consults for clamps and missing received_at. */
function clocked(village: Village, start: number) {
  let t = start;
  const engine = new ReplayEngine(village, () => t);
  return {
    engine,
    get t() {
      return t;
    },
    set(ms: number) {
      t = ms;
    },
  };
}

const stateOf = (v: Village, id: string): string | null =>
  v.agents.find((a) => a.agentId === id)?.state ?? null;

describe("ReplayEngine recording", () => {
  it("ignores malformed input and stamps a fake clock", () => {
    const { engine } = clocked(new Village(new Scene()), 7777);
    for (const bad of [null, 42, "hi", [1, 2], undefined]) {
      expect(() => engine.ingest(bad)).not.toThrow();
    }
    expect(engine.recorded).toHaveLength(0);
    engine.ingest({ agent_id: "a", type: "plan" }); // no received_at
    expect(engine.recorded).toHaveLength(1);
    expect(engine.recorded[0]!.t).toBe(7777);
    expect(engine.firstT).toBe(7777);
  });

  it("caps the tape at 5000 entries, dropping oldest first", () => {
    const { engine } = clocked(new Village(new Scene()), 0);
    for (let i = 0; i < 5010; i++) {
      engine.ingest({ agent_id: `a${i}`, type: "plan", received_at: i * 100 });
    }
    expect(engine.recorded).toHaveLength(5000);
    expect(engine.recorded[0]!.t).toBe(100 * 10); // first 10 evicted
    expect(engine.recorded[4999]!.t).toBe(5009 * 100);
    expect(engine.firstT).toBe(0); // session start unchanged
  });

  it("tracks per-agent session stats", () => {
    const { engine } = clocked(new Village(new Scene()), 0);
    engine.ingest({ agent_id: "atlas", name: "Atlas", type: "plan", received_at: 1 });
    engine.ingest({
      agent_id: "atlas",
      type: "token_usage",
      tokens_in: 300,
      tokens_out: 50,
      cost: 0.01,
      received_at: 2,
    });
    engine.ingest({ agent_id: "atlas", type: "done", received_at: 3 });
    engine.ingest({ agent_id: "brick", type: "read", received_at: 4 }); // name falls back to id
    const atlas = engine.stats.get("atlas")!;
    expect(atlas.name).toBe("Atlas");
    expect(atlas.events).toBe(3);
    expect(atlas.tokens).toBe(350);
    expect(atlas.cost).toBeCloseTo(0.01, 6);
    expect(atlas.shipped).toBe(1);
    expect(atlas.lastType).toBe("done");
    expect(engine.stats.get("brick")!.name).toBe("brick");
  });
});

describe("toastFor", () => {
  it("fires on loud events", () => {
    expect(toastFor({ type: "error", agent_id: "b", detail: "boom" })?.title).toBe("b → error");
    expect(toastFor({ type: "approval", agent_id: "b" })?.color).toBe("#ffb84d");
    expect(toastFor({ type: "security_check", agent_id: "b" })?.color).toBe("#ffb84d");
    expect(toastFor({ type: "ship", agent_id: "b" })?.color).toBe("#4fd67a");
  });

  it("flags failing tests and stays quiet on the rest", () => {
    expect(toastFor({ type: "test", agent_id: "b", detail: "1 failed: corner" })?.color).toBe(
      "#d0342c",
    );
    expect(toastFor({ type: "test", agent_id: "b", detail: "34 passed" })).toBeNull();
    expect(toastFor({ type: "plan", agent_id: "b" })).toBeNull();
    expect(toastFor({ type: "token_usage", agent_id: "b" })).toBeNull();
    expect(toastFor({ type: "done", agent_id: "b" })).toBeNull();
  });
});

describe("countersAt", () => {
  it("mirrors Village counter rules on tape boundaries", () => {
    const { engine } = clocked(new Village(new Scene()), 0);
    engine.ingest({ agent_id: "a", type: "token_usage", tokens_in: 3000, tokens_out: 500, cost: 0.042, received_at: 1000 });
    engine.ingest({ agent_id: "a", type: "done", received_at: 2000 });
    engine.ingest({ agent_id: "b", type: "write", file: "x.ts", cost: 0.1, received_at: 3000 });
    engine.ingest({ agent_id: "b", type: "token_usage", tokens_in: 100, cost: 0.001, received_at: 4000 });

    expect(engine.countersAt(999)).toEqual({ tokens: 0, cost: 0, shipped: 0 });
    expect(engine.countersAt(1000).tokens).toBe(3500);
    expect(engine.countersAt(1000).cost).toBeCloseTo(0.042, 6);
    expect(engine.countersAt(2000).shipped).toBe(1);
    expect(engine.countersAt(3000).cost).toBeCloseTo(0.142, 6);
    const all = engine.countersAt(Number.MAX_SAFE_INTEGER);
    expect(all.tokens).toBe(3600);
    expect(all.shipped).toBe(1);
    expect(all.cost).toBeCloseTo(0.143, 6);
  });
});

describe("ReplayEngine seek / rebuild", () => {
  function session() {
    const v = new Village(new Scene());
    const c = clocked(v, 30_000);
    const { engine } = c;
    engine.ingest({ agent_id: "flaky", type: "write", file: "a.ts", received_at: 10_000 });
    engine.ingest({ agent_id: "flaky", type: "write", file: "b.ts", received_at: 12_000 });
    engine.ingest({ agent_id: "flaky", type: "write", file: "c.ts", received_at: 14_000 });
    engine.ingest({ agent_id: "flaky", type: "error", detail: "boom 1", received_at: 20_000 });
    engine.ingest({ agent_id: "atlas", type: "token_usage", tokens_in: 2000, tokens_out: 500, cost: 0.05, received_at: 22_000 });
    engine.ingest({ agent_id: "flaky", type: "error", detail: "boom 2", received_at: 23_000 });
    engine.ingest({ agent_id: "atlas", type: "done", received_at: 26_000 });
    return { v, c, engine };
  }

  it("seek rebuilds counters, trims queues to the latest task, and reconstructs the crash", () => {
    const { v, engine } = session();
    engine.seek(25_000); // after both errors, before done

    expect(engine.mode).toBe("replay");
    expect(engine.paused).toBe(true);
    expect(engine.replayTime).toBe(25_000);

    // counters rebuilt from the tape
    expect(v.counters.tokens).toBe(2500);
    expect(v.counters.cost).toBeCloseTo(0.05, 6);
    expect(v.counters.shipped).toBe(0);
    expect(v.agents).toHaveLength(2); // roster persists across a rebuild (positions kept)

    // crash reconstructed (two errors inside the 8s window)
    expect(stateOf(v, "flaky")).toBe("crashed");
    for (let i = 0; i < 60; i++) v.update(1 / 60);
    expect(v.counters.active).toBe(0); // crashed builder holds no tasks
  });

  it("keeps only the latest queued task after a multi-event rebuild", () => {
    const v = new Village(new Scene());
    const engine = new ReplayEngine(v, () => 30_000);
    engine.ingest({ agent_id: "q", type: "write", file: "a.ts", received_at: 1000 });
    engine.ingest({ agent_id: "q", type: "write", file: "b.ts", received_at: 2000 });
    engine.ingest({ agent_id: "q", type: "write", file: "c.ts", received_at: 3000 });
    engine.seek(5000);
    const q = v.agents.find((a) => a.agentId === "q")!;
    expect(q.queueLength).toBe(1); // trimmed to the latest task
  });

  it("seeking before the second error leaves the agent un-crashed", () => {
    const { v, engine } = session();
    engine.seek(21_000); // after boom 1, before boom 2
    const flaky = v.agents.find((a) => a.agentId === "flaky")!;
    expect(flaky.queueLength).toBe(2); // trimmed latest write + boom 1's incident task
    expect(flaky.state).not.toBe("crashed"); // one error is not a crash
    expect(v.counters.tokens).toBe(0); // token_usage at 22s not fed yet
    expect(v.counters.shipped).toBe(0);
  });

  it("seek clamps to the tape start and the wall clock", () => {
    const { c, engine } = session();
    engine.seek(-99_999);
    expect(engine.replayTime).toBe(10_000); // clamped to firstT
    engine.seek(999_999);
    expect(engine.replayTime).toBe(c.t); // clamped to now
  });
});

describe("ReplayEngine playback and go-live", () => {
  it("paused playheads do not feed events", () => {
    const v = new Village(new Scene());
    const engine = new ReplayEngine(v, () => 20_000);
    engine.ingest({ agent_id: "a", type: "write", file: "a.ts", received_at: 10_000 });
    engine.ingest({ agent_id: "a", type: "write", file: "b.ts", received_at: 15_000 });
    engine.seek(11_000);
    engine.tick(1);
    const a = v.agents.find((x) => x.agentId === "a")!;
    expect(a.queueLength).toBe(1); // event at 15s not yet fed
    expect(engine.mode).toBe("replay");
    expect(engine.paused).toBe(true);
  });

  it("play advances the playhead, feeds events, then auto-returns to live", () => {
    let nowMs = 20_000;
    const v = new Village(new Scene());
    const engine = new ReplayEngine(v, () => nowMs);
    engine.ingest({ agent_id: "a", type: "write", file: "a.ts", received_at: 10_000 });
    engine.ingest({ agent_id: "a", type: "write", file: "b.ts", received_at: 15_000 });
    engine.seek(11_000);
    engine.play();

    engine.tick(2); // 11 + 2 = 13s < 15s → second write not fed
    expect(engine.replayTime).toBe(13_000);
    expect(v.agents.find((x) => x.agentId === "a")!.queueLength).toBe(1);

    engine.tick(3); // 16s > 15s → fed
    expect(v.agents.find((x) => x.agentId === "a")!.queueLength).toBe(2);

    nowMs = 16_050; // playhead caught the wall clock
    engine.tick(1);
    expect(engine.mode).toBe("live");
    expect(engine.paused).toBe(false);
    expect(engine.speed).toBe(1);
    expect(v.replayPacing).toBe(false);
  });

  it("goLive restores every event's worth of counters and resumes recording", () => {
    const { v, engine } = session6();
    engine.seek(21_000);
    expect(v.counters.shipped).toBe(0);
    engine.goLive();

    expect(engine.mode).toBe("live");
    expect(v.counters.tokens).toBe(2500);
    expect(v.counters.shipped).toBe(1);
    expect(v.counters.cost).toBeCloseTo(0.05, 6);
    expect(v.replayPacing).toBe(false);

    // live enqueues accumulate again (no trim)
    engine.ingest({ agent_id: "atlas", type: "plan", received_at: 40_000 });
    engine.ingest({ agent_id: "atlas", type: "read", file: "b.ts", received_at: 41_000 });
    engine.ingest({ agent_id: "atlas", type: "write", file: "c.ts", received_at: 42_000 });
    const atlas = v.agents.find((a) => a.agentId === "atlas")!;
    expect(atlas.queueLength + (atlas.currentBuilding ? 1 : 0)).toBeGreaterThanOrEqual(3);
  });

  it("pause from live freezes the world; live events still record", () => {
    const v = new Village(new Scene());
    const engine = new ReplayEngine(v, () => 30_000);
    engine.ingest({ agent_id: "a", type: "write", file: "a.ts", received_at: 10_000 });
    engine.pause();
    expect(engine.mode).toBe("replay");
    expect(engine.paused).toBe(true);

    engine.ingest({ agent_id: "a", type: "write", file: "b.ts", received_at: 31_000 });
    expect(engine.recorded).toHaveLength(2); // recorded...
    expect(v.agents.find((x) => x.agentId === "a")!.queueLength).toBe(1); // ...not fed
  });

  it("cycles speed 1 → 4 → 16 → 1", () => {
    const { engine } = clocked(new Village(new Scene()), 0);
    expect(engine.speed).toBe(1);
    engine.cycleSpeed();
    expect(engine.speed).toBe(4);
    engine.cycleSpeed();
    expect(engine.speed).toBe(16);
    engine.cycleSpeed();
    expect(engine.speed).toBe(1);
  });

  it("speed multiplies playback advance", () => {
    const v = new Village(new Scene());
    const engine = new ReplayEngine(v, () => 60_000);
    engine.ingest({ agent_id: "a", type: "plan", received_at: 10_000 });
    engine.seek(10_000);
    engine.play();
    engine.cycleSpeed(); // ×4
    engine.tick(5); // 5s wall → 20s of tape
    expect(engine.replayTime).toBe(30_000);
  });
});

describe("crash toasts", () => {
  it("fires on a live double-error and stays silent during rebuild", () => {
    const v = new Village(new Scene());
    const engine = new ReplayEngine(v, () => 60_000);
    const toasts: string[] = [];
    engine.onToast = (t) => toasts.push(t.title);

    engine.ingest({ agent_id: "flaky", name: "Flaky", type: "error", received_at: 10_000 });
    engine.ingest({ agent_id: "flaky", type: "error", received_at: 12_000 });
    expect(toasts.some((t) => t.includes("Flaky crashed"))).toBe(true);

    const before = toasts.length;
    engine.seek(13_000); // quiet rebuild of the same crash
    expect(toasts).toHaveLength(before);
    expect(stateOf(v, "flaky")).toBe("crashed");
  });
});

/** Small shared session used by the go-live test. */
function session6() {
  const v = new Village(new Scene());
  const engine = new ReplayEngine(v, () => 30_000);
  engine.ingest({ agent_id: "atlas", type: "token_usage", tokens_in: 2000, tokens_out: 500, cost: 0.05, received_at: 10_000 });
  engine.ingest({ agent_id: "atlas", type: "done", received_at: 26_000 });
  return { v, engine };
}
