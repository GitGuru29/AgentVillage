import { Group, type Object3D } from "three";
import { createBuilding, type BuildingInstance } from "./buildings";
import { agentColor, Builder } from "./builder";
import { NavGrid } from "./grid";
import { BUILDINGS, IDLE_CAMP, type BuildingKey } from "./layout";
import { createTerrain } from "./terrain";

/** Which building an event type belongs to (unknown → Mystery Hut later). */
export function buildingForType(type: string): BuildingKey | null {
  switch (type) {
    case "plan":
    case "done":
      return "townHall";
    case "read":
      return "library";
    case "write":
      return "forge";
    case "tool_call":
      return "barracks";
    case "test":
      return "archery";
    default:
      return null;
  }
}

/** A test passes unless its detail says otherwise. */
export function testPassed(detail?: string): boolean {
  if (!detail) return true;
  return !/\b(fail(ed|ure)?|✗|error|broken)\b/i.test(detail);
}

export interface Counters {
  /** tokens → gold */
  gold: number;
  /** cost in $ → elixir */
  elixir: number;
  /** completed tasks */
  trophies: number;
  /** builders busy with a task */
  active: number;
  /** builders alive */
  total: number;
}

const MAX_BUILDERS = 12;

export class Village {
  readonly grid: NavGrid;
  readonly root = new Group();
  readonly buildings = {} as Record<BuildingKey, BuildingInstance>;
  readonly counters: Counters = { gold: 0, elixir: 0, trophies: 0, active: 0, total: 0 };
  onCounters?: (c: Counters) => void;

  private builders = new Map<string, Builder>();
  private elapsed = 0;
  private lastActive = -1;
  private dirty = false;

  constructor(parent: Object3D) {
    this.grid = new NavGrid(96);
    this.root.add(createTerrain(this.grid));
    for (const spec of BUILDINGS) {
      const b = createBuilding(spec);
      this.buildings[b.key] = b;
      this.root.add(b.group);
    }
    parent.add(this.root);
  }

  /** Feed every WebSocket / HTTP event straight in. Ignores malformed input. */
  handleEvent(raw: unknown): void {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const e = raw as Record<string, unknown>;
    const agentId = typeof e.agent_id === "string" ? e.agent_id : null;
    const type = typeof e.type === "string" ? e.type : null;
    if (!agentId || !type) return;

    const detail = typeof e.detail === "string" ? e.detail : undefined;
    const tool = typeof e.tool === "string" ? e.tool : undefined;
    const duration = typeof e.duration_ms === "number" ? e.duration_ms : undefined;
    const name = typeof e.name === "string" && e.name.length > 0 ? e.name : agentId;

    // --- HUD counters ------------------------------------------------------
    if (type === "token_usage") {
      const tin = num(e.tokens_in);
      const tout = num(e.tokens_out);
      if (tin + tout > 0) {
        this.counters.gold += tin + tout;
        this.dirty = true;
      }
      const cost = num(e.cost);
      if (cost > 0) {
        this.counters.elixir += cost;
        this.dirty = true;
      }
    }
    const cost = num(e.cost);
    if (type !== "token_usage" && cost > 0) {
      this.counters.elixir += cost;
      this.dirty = true;
    }
    if (type === "done") {
      this.counters.trophies += 1;
      this.dirty = true;
    }

    // --- building effects ---------------------------------------------------
    const key = buildingForType(type);
    switch (type) {
      case "plan":
        this.buildings.townHall.pulse?.(2.6);
        break;
      case "done":
        this.buildings.townHall.pulse?.(1.6);
        break;
      case "read":
        this.buildings.library.spawnBook?.();
        break;
      case "write":
        this.buildings.forge.launchBrick?.(agentId);
        break;
      case "tool_call":
        this.buildings.barracks.marchUnit?.(tool ?? "shell", duration ?? 1600);
        break;
      case "test":
        this.buildings.archery.testResult?.(testPassed(detail));
        break;
      default:
        break;
    }

    // --- route the builder ---------------------------------------------------
    if (key) {
      const b = this.getOrCreate(agentId, name);
      const workSeconds = duration
        ? Math.max(1, Math.min(4, duration / 1000))
        : 2.2;
      b.enqueue({ building: this.buildings[key], workSeconds });
    }

    if (this.dirty) this.emit();
  }

  update(dt: number): void {
    this.elapsed += dt;
    const list = [...this.builders.values()];
    for (const b of list) b.update(dt, this.elapsed, list, this.grid);
    for (const spec of BUILDINGS) this.buildings[spec.key].update(dt, this.elapsed);

    const active = list.filter((b) => b.active).length;
    if (active !== this.lastActive) {
      this.lastActive = active;
      this.counters.active = active;
      this.counters.total = list.length;
      this.emit();
    }
  }

  private getOrCreate(agentId: string, name: string): Builder {
    let b = this.builders.get(agentId);
    if (b) return b;
    if (this.builders.size >= MAX_BUILDERS) {
      // Reuse the most idle builder rather than growing without bound.
      const idle = [...this.builders.values()].find((x) => !x.hasTasks());
      if (idle) return idle;
      const first = this.builders.values().next().value;
      if (first) return first;
      throw new Error("unreachable");
    }
    b = new Builder(agentId, name, agentColor(agentId), IDLE_CAMP, this.grid);
    this.builders.set(agentId, b);
    this.root.add(b.group);
    this.counters.total = this.builders.size;
    this.dirty = true;
    return b;
  }

  private emit(): void {
    this.dirty = false;
    this.onCounters?.({ ...this.counters });
  }
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}
