import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import type { MeshStandardMaterialParameters } from "three";
import type { NavGrid } from "./grid";
import { PALETTE, PLAZA, WALLS, type BuildingKey, type BuildingSpec } from "./layout";

export interface BuildingInstance {
  key: BuildingKey;
  group: Group;
  footprint: { x0: number; z0: number; x1: number; z1: number };
  door: { x: number; z: number };
  update(dt: number, elapsed: number): void;
  /** Town Hall glow while planning (also used for celebrations). */
  pulse?(duration?: number): void;
  /** Library: a book flies out onto the reading pile. */
  spawnBook?(): void;
  /** Forge: glowing code brick arcs onto this agent's tower. */
  launchBrick?(agentId: string): void;
  /** Forge: tower collapses when its task completes. */
  resetStack?(agentId: string): void;
  /** Barracks: a tool unit marches out and returns. */
  marchUnit?(tool: string, durationMs: number): void;
  /** Archery Range: green flag (pass) or cannonball crater (fail). */
  testResult?(pass: boolean): void;
  /** Gold Mine: coin shower for token usage. */
  mineGold?(amount: number): void;
  /** Elixir Collector: bubbles rise for every dollar spent. */
  collect?(cost: number): void;
  /** Trophy Hall: a trophy lands on the shelf. */
  addTrophy?(): void;
}

type Opts = MeshStandardMaterialParameters;

function mat(color: string | number, opts: Opts = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, ...opts });
}

function box(w: number, h: number, d: number, color: string | number, opts: Opts = {}): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function pyramid(radius: number, height: number, color: string | number): Mesh {
  const m = new Mesh(new ConeGeometry(radius, height, 4), mat(color));
  m.rotation.y = Math.PI / 4;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cylinder(
  rt: number,
  rb: number,
  h: number,
  color: string | number,
  opts: Opts = {},
): Mesh {
  const m = new Mesh(new CylinderGeometry(rt, rb, h, 12), mat(color, opts));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function disposeDeep(obj: Mesh): void {
  obj.geometry.dispose();
  (obj.material as MeshStandardMaterial).dispose();
}

/**
 * Parabolic-flight + fade FX. Flight meshes live in `host()` (the scene) so
 * they're visible mid-air, then get re-parented into the building on landing.
 * All positions are explicit world/local math — never matrixWorld, so this
 * also runs headless in tests.
 */
class Fx {
  private flights: Array<{
    mesh: Mesh;
    t: number;
    dur: number;
    from: Vector3;
    to: Vector3;
    arc: number;
    onLand?: (mesh: Mesh) => void;
  }> = [];
  private fades: Array<{ mesh: Mesh; t: number; dur: number }> = [];

  constructor(private host: () => Object3D | null) {}

  fly(
    mesh: Mesh,
    from: Vector3,
    to: Vector3,
    arc: number,
    dur: number,
    onLand?: (m: Mesh) => void,
  ): void {
    mesh.position.copy(from);
    this.host()?.add(mesh);
    this.flights.push({ mesh, t: 0, dur, from, to, arc, onLand });
  }

  fade(mesh: Mesh, dur = 0.5): void {
    this.fades.push({ mesh, t: 0, dur });
  }

  update(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]!;
      f.t = Math.min(1, f.t + dt / f.dur);
      const p = f.t;
      const ease = p * p * (3 - 2 * p);
      f.mesh.position.lerpVectors(f.from, f.to, ease);
      f.mesh.position.y += Math.sin(Math.PI * p) * f.arc;
      f.mesh.rotation.y += dt * 7;
      if (f.t >= 1) {
        this.flights.splice(i, 1);
        if (f.onLand) {
          f.mesh.rotation.y = 0;
          f.onLand(f.mesh);
        } else {
          f.mesh.removeFromParent();
          disposeDeep(f.mesh);
        }
      }
    }
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const f = this.fades[i]!;
      f.t += dt;
      f.mesh.scale.setScalar(Math.max(0.001, 1 - f.t / f.dur));
      if (f.t >= f.dur) {
        this.fades.splice(i, 1);
        f.mesh.removeFromParent();
        disposeDeep(f.mesh);
      }
    }
  }
}

function footprintOf(spec: BuildingSpec): BuildingInstance["footprint"] {
  return {
    x0: spec.x - spec.w / 2,
    z0: spec.z - spec.d / 2,
    x1: spec.x + spec.w / 2,
    z1: spec.z + spec.d / 2,
  };
}

// ---------------------------------------------------------------------------
// Town Hall — the orchestrator. Glows while planning.
// ---------------------------------------------------------------------------
function createTownHall(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "townHall";
  g.position.set(spec.x, 0, spec.z);

  const base = box(8, 1.4, 8, PALETTE.stone);
  base.position.y = 0.7;
  g.add(base);

  const walls = box(6.6, 3.2, 6.6, PALETTE.cream);
  walls.position.y = 3.0;
  g.add(walls);

  const roof = pyramid(5.4, 3, PALETTE.roofRed);
  roof.position.y = 6.1;
  g.add(roof);

  const door = box(1.6, 2.2, 0.35, PALETTE.darkWood);
  door.position.set(0, 2.5, 3.4);
  g.add(door);

  const trimMat = mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.15 });
  const trim = new Mesh(new BoxGeometry(6.8, 0.34, 6.8), trimMat);
  trim.position.y = 4.55;
  g.add(trim);

  const winMat = mat("#2b3244", { emissive: "#ffd873", emissiveIntensity: 0.15 });
  for (const x of [-1.9, 1.9]) {
    const w = new Mesh(new BoxGeometry(1.0, 1.0, 0.25), winMat);
    w.position.set(x, 3.2, 3.4);
    g.add(w);
  }

  const pole = cylinder(0.07, 0.07, 2.0, "#d8d8e0");
  pole.position.y = 8.5;
  g.add(pole);
  const flag = box(1.2, 0.7, 0.08, PALETTE.gold);
  flag.position.set(0.66, 9.1, 0);
  g.add(flag);

  let glowT = 0;
  let glowLevel = 0.15;

  return {
    key: "townHall",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    pulse(duration = 2.4) {
      glowT = Math.max(glowT, duration);
    },
    update(dt, elapsed) {
      glowT = Math.max(0, glowT - dt);
      const target = glowT > 0 ? 1.5 + 0.6 * Math.sin(elapsed * 7) : 0.15;
      glowLevel += (target - glowLevel) * Math.min(1, dt * 8);
      winMat.emissiveIntensity = glowLevel;
      trimMat.emissiveIntensity = glowLevel * 0.8;
      flag.rotation.z = Math.sin(elapsed * 2.4) * 0.12;
    },
  };
}

// ---------------------------------------------------------------------------
// Library — file reads/searches. Books pop out onto a reading pile.
// ---------------------------------------------------------------------------
const BOOK_COLORS = ["#e05252", "#4fc3f7", "#ffd23f", "#8bd450", "#b388ff", "#ff8a3d"];

function createLibrary(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "library";
  g.position.set(spec.x, 0, spec.z);

  const skirt = box(6.4, 0.4, 5.4, PALETTE.stone);
  skirt.position.y = 0.2;
  g.add(skirt);

  const walls = box(6, 2.6, 5, "#e8dcc0");
  walls.position.y = 1.7;
  g.add(walls);

  const roof = pyramid(4.6, 2.4, PALETTE.roofBlue);
  roof.position.y = 4.2;
  g.add(roof);

  const door = box(1.4, 1.9, 0.3, PALETTE.darkWood);
  door.position.set(0, 1.35, 2.55);
  g.add(door);

  BOOK_COLORS.forEach((c, i) => {
    const b = box(0.5, 0.72, 0.18, c);
    b.position.set(-1.75 + i * 0.7, 2.2, 2.6);
    g.add(b);
  });

  const windowMesh = cylinder(0.55, 0.55, 0.25, "#bfe3ff", {
    emissive: "#8fd4ff",
    emissiveIntensity: 0.35,
  });
  windowMesh.rotation.z = Math.PI / 2;
  windowMesh.position.set(3.05, 2.0, 0);
  g.add(windowMesh);

  // Reading pile: pile-local coords == g-local minus the pile offset.
  const PILE = { x: -4.2, z: 3.0 };
  const pileBricks: Mesh[] = [];
  const fx = new Fx(() => g.parent);

  function spawnBook(): void {
    const n = pileBricks.length;
    const color = BOOK_COLORS[Math.floor(Math.random() * BOOK_COLORS.length)]!;
    const book = box(0.55, 0.14, 0.4, color);
    const dx = (Math.random() - 0.5) * 0.35;
    const dz = (Math.random() - 0.5) * 0.35;
    const y = 0.08 + n * 0.15;
    const from = new Vector3(spec.x, 1.7, spec.z + 3.0);
    const to = new Vector3(spec.x + PILE.x + dx, y, spec.z + PILE.z + dz);
    fx.fly(book, from, to, 1.7, 0.7, (m) => {
      m.position.set(PILE.x + dx, y, PILE.z + dz);
      m.rotation.set(0, (Math.random() - 0.5) * 0.7, 0);
      g.add(m);
      pileBricks.push(m);
      if (pileBricks.length > 9) {
        const old = pileBricks.shift()!;
        fx.fade(old, 0.4);
      }
    });
  }

  return {
    key: "library",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    spawnBook,
    update(dt) {
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Forge — code writes. Glowing bricks fly out and stack into a tower per task.
// ---------------------------------------------------------------------------
const BRICK_SLOTS: Array<[number, number]> = [
  [4.8, -1.4],
  [4.8, -0.1],
  [4.8, 1.2],
  [-4.8, -0.6],
];

function createForge(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "forge";
  g.position.set(spec.x, 0, spec.z);

  const walls = box(6, 2.8, 5, "#5d6472");
  walls.position.y = 1.4;
  g.add(walls);

  const roof = pyramid(4.5, 1.9, PALETTE.roofRust);
  roof.position.y = 3.75;
  g.add(roof);

  const chimney = cylinder(0.5, 0.62, 2.8, "#4a4f5a");
  chimney.position.set(1.9, 4.6, -1.4);
  g.add(chimney);

  const mouthMat = mat("#2a1a12", { emissive: PALETTE.forgeFire, emissiveIntensity: 1.4 });
  const mouth = new Mesh(new BoxGeometry(1.8, 1.2, 0.35), mouthMat);
  mouth.position.set(0, 0.95, 2.6);
  g.add(mouth);

  const anvilTop = box(1.1, 0.3, 0.5, "#3b3f4a", { metalness: 0.5, roughness: 0.5 });
  anvilTop.position.set(0, 0.85, 1.85);
  const anvilBase = box(0.8, 0.55, 0.65, "#2f333d");
  anvilBase.position.set(0, 0.28, 1.85);
  g.add(anvilBase, anvilTop);

  type Stack = { owner: string; slot: number; count: number; bricks: Mesh[] };
  const stacks: Stack[] = [];
  const fx = new Fx(() => g.parent);

  function stackFor(agentId: string): Stack {
    const existing = stacks.find((s) => s.owner === agentId);
    if (existing) return existing;
    if (stacks.length < BRICK_SLOTS.length) {
      const s: Stack = { owner: agentId, slot: stacks.length, count: 0, bricks: [] };
      stacks.push(s);
      return s;
    }
    // Steal the oldest slot: its tower crumbles first.
    const victim = stacks[0]!;
    clearStack(victim);
    victim.owner = agentId;
    return victim;
  }

  function clearStack(s: Stack): void {
    for (const b of s.bricks) fx.fade(b, 0.45);
    s.bricks = [];
    s.count = 0;
  }

  function resetStack(agentId: string): void {
    const s = stacks.find((x) => x.owner === agentId);
    if (s) clearStack(s);
  }

  function launchBrick(agentId: string): void {
    const s = stackFor(agentId);
    if (s.count >= 14) clearStack(s);
    const [sx, sz] = BRICK_SLOTS[s.slot]!;
    const y = 0.18 + s.count * 0.37;
    s.count++;
    const dx = (Math.random() - 0.5) * 0.12;
    const dz = (Math.random() - 0.5) * 0.1;
    const brick = box(0.78, 0.36, 0.52, PALETTE.glowCode, {
      emissive: "#35c8ff",
      emissiveIntensity: 1.1,
      roughness: 0.4,
    });
    const from = new Vector3(spec.x, 1.7, spec.z + 2.9);
    const to = new Vector3(spec.x + sx + dx, y, spec.z + sz + dz);
    fx.fly(brick, from, to, 2.6, 0.62, (m) => {
      m.position.set(sx + dx, y, sz + dz);
      m.rotation.y = (Math.random() - 0.5) * 0.4;
      g.add(m);
      s.bricks.push(m);
    });
  }

  return {
    key: "forge",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    launchBrick,
    resetStack,
    update(dt, elapsed) {
      mouthMat.emissiveIntensity =
        1.35 + 0.4 * Math.sin(elapsed * 9.7) + 0.18 * Math.sin(elapsed * 23);
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Barracks — tool calls. Units march out and return.
// ---------------------------------------------------------------------------
const TOOL_COLORS: Record<string, string> = {
  shell: "#9acd32",
  git: "#f0592f",
  web: "#4fc3f7",
  grep: "#ffd23f",
  read: "#ffd23f",
  search: "#ffd23f",
  mcp: "#b388ff",
};

function createBarracks(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "barracks";
  g.position.set(spec.x, 0, spec.z);

  const walls = box(6, 2.6, 5, PALETTE.wood);
  walls.position.y = 1.3;
  g.add(walls);

  const roof = pyramid(4.4, 1.7, "#7c4a2b");
  roof.position.y = 3.45;
  g.add(roof);

  const door = box(1.5, 2.0, 0.3, PALETTE.darkWood);
  door.position.set(0, 1.0, 2.55);
  g.add(door);

  const banner = box(1.0, 1.4, 0.12, PALETTE.roofRed);
  banner.position.set(2.0, 1.7, 2.62);
  g.add(banner);

  for (const x of [-2.3, -2.0]) {
    const spear = cylinder(0.05, 0.05, 2.3, "#8a6a42");
    spear.position.set(x, 1.15, 2.62);
    spear.rotation.z = x === -2.3 ? 0.22 : -0.16;
    g.add(spear);
  }

  type Unit = { group: Group; legs: Mesh[]; t: number; dur: number };
  const units: Unit[] = [];
  const dir = new Vector3(PLAZA.x - spec.x, 0, PLAZA.z - spec.doorZ).normalize();

  function marchUnit(tool: string, durationMs: number): void {
    if (units.length >= 5) return;
    const parent = g.parent;
    if (!parent) return;
    const color = TOOL_COLORS[(tool ?? "").toLowerCase()] ?? "#c8c8d4";
    const unit = new Group();
    const body = box(0.55, 0.55, 0.42, color);
    body.position.y = 0.62;
    const head = box(0.36, 0.32, 0.36, "#dfe3ec");
    head.position.y = 1.05;
    const visor = box(0.26, 0.1, 0.06, "#232a38", {
      emissive: color,
      emissiveIntensity: 0.7,
    });
    visor.position.set(0, 1.07, 0.2);
    const legA = box(0.16, 0.34, 0.18, "#3b3f4a");
    const legB = box(0.16, 0.34, 0.18, "#3b3f4a");
    legA.position.set(-0.14, 0.17, 0);
    legB.position.set(0.14, 0.17, 0);
    unit.add(body, head, visor, legA, legB);
    unit.position.set(spec.x, 0, spec.doorZ);
    parent.add(unit);
    units.push({
      group: unit,
      legs: [legA, legB],
      t: 0,
      dur: Math.max(0.9, Math.min(7, durationMs / 1000)),
    });
  }

  return {
    key: "barracks",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    marchUnit,
    update(dt) {
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i]!;
        u.t += dt / u.dur;
        if (u.t >= 1) {
          u.group.removeFromParent();
          u.group.traverse((o) => {
            const mesh = o as Mesh;
            if (mesh.isMesh) disposeDeep(mesh);
          });
          units.splice(i, 1);
          continue;
        }
        const out = Math.sin(u.t * Math.PI) * 6.5;
        u.group.position.set(spec.x + dir.x * out, 0, spec.doorZ + dir.z * out);
        const goingOut = u.t < 0.5;
        u.group.rotation.y = Math.atan2(
          goingOut ? dir.x : -dir.x,
          goingOut ? dir.z : -dir.z,
        );
        const swing = Math.sin(u.t * u.dur * 14) * 0.55;
        u.legs[0]!.rotation.x = swing;
        u.legs[1]!.rotation.x = -swing;
        u.group.position.y = Math.abs(Math.sin(u.t * u.dur * 14)) * 0.06;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Archery Range — tests. Green flag on pass, cannonball crater on fail.
// ---------------------------------------------------------------------------
function createArchery(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "archery";
  g.position.set(spec.x, 0, spec.z);

  const platform = box(7, 0.35, 5, PALETTE.wood);
  platform.position.y = 0.175;
  g.add(platform);

  const buttWhite = mat("#f2f2f2");
  const buttRed = mat(PALETTE.failRed);
  for (const x of [-2.2, 0, 2.2]) {
    const post = box(0.15, 1.3, 0.15, PALETTE.darkWood);
    post.position.set(x, 1.0, -1.3);
    g.add(post);
    const outer = new Mesh(new CylinderGeometry(0.72, 0.72, 0.26, 18), buttWhite);
    outer.rotation.x = Math.PI / 2;
    outer.position.set(x, 1.62, -1.3);
    outer.castShadow = true;
    const inner = new Mesh(new CylinderGeometry(0.34, 0.34, 0.3, 18), buttRed);
    inner.rotation.x = Math.PI / 2;
    inner.position.set(x, 1.62, -1.28);
    g.add(outer, inner);
  }

  for (const x of [-2.9, 2.9]) {
    const hay = cylinder(0.62, 0.62, 1.0, "#e8c766");
    hay.rotation.z = Math.PI / 2;
    hay.position.set(x, 0.85, 1.4);
    g.add(hay);
  }

  const pole = cylinder(0.07, 0.07, 3.2, "#d8d8e0");
  pole.position.set(-3.1, 1.95, 1.9);
  g.add(pole);
  const flagMat = mat("#9aa3b2");
  const flag = new Mesh(new BoxGeometry(1.1, 0.65, 0.07), flagMat);
  flag.castShadow = true;
  flag.position.set(-2.5, 0.7, 1.9);
  g.add(flag);

  const craterMat = new MeshStandardMaterial({
    color: "#40342a",
    roughness: 1,
    transparent: true,
    opacity: 1,
  });
  const crater = new Mesh(new CircleGeometry(1.15, 24), craterMat);
  crater.rotation.x = -Math.PI / 2;
  crater.position.set(0.5, 0.03, 3.6);
  crater.visible = false;
  g.add(crater);

  const fx = new Fx(() => g.parent);
  let flagT = -1;
  let craterT = -1;

  function testResult(pass: boolean): void {
    if (pass) {
      flagMat.color.set(PALETTE.flagGreen);
      flagT = 0;
    } else {
      crater.visible = true;
      craterMat.opacity = 1;
      craterT = 0;
      const ball = new Mesh(new SphereGeometry(0.5, 14, 12), mat(PALETTE.failRed));
      ball.castShadow = true;
      const from = new Vector3(spec.x + 3.5, 7, spec.z + 9);
      const to = new Vector3(spec.x + 0.5, 0.5, spec.z + 3.6);
      fx.fly(ball, from, to, 0.5, 0.55, (m) => {
        m.position.set(0.5, 0.5, 3.6);
        g.add(m);
        fx.fade(m, 5.5);
      });
    }
  }

  return {
    key: "archery",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    testResult,
    update(dt, elapsed) {
      fx.update(dt);

      if (flagT >= 0) {
        flagT += dt;
        const RAISE = 0.55;
        const HOLD = 4;
        const LOWER = 0.55;
        if (flagT < RAISE) {
          const k = flagT / RAISE;
          flag.position.y = 2.6 - 1.9 * (1 - k) * (1 - k);
        } else if (flagT < RAISE + HOLD) {
          flag.position.y = 2.6;
          flag.rotation.z = Math.sin(elapsed * 6) * 0.1;
        } else if (flagT < RAISE + HOLD + LOWER) {
          const k = (flagT - RAISE - HOLD) / LOWER;
          flag.position.y = 0.7 + 1.9 * (1 - k) * (1 - k);
          flag.rotation.z = 0;
        } else {
          flagT = -1;
          flag.position.y = 0.7;
          flagMat.color.set("#9aa3b2");
        }
      }

      if (craterT >= 0) {
        craterT += dt;
        if (craterT > 5) craterMat.opacity = Math.max(0, 1 - (craterT - 5) / 1.5);
        if (craterT > 6.5) {
          craterT = -1;
          crater.visible = false;
          craterMat.opacity = 1;
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Gold Mine — token usage. Coins shower out of the cave onto a heap.
// ---------------------------------------------------------------------------
function createGoldMine(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "goldMine";
  g.position.set(spec.x, 0, spec.z);

  const slab = box(7, 0.4, 6, "#8a8f9c");
  slab.position.y = 0.2;
  g.add(slab);

  const mound = cylinder(2.4, 3.1, 2.3, "#7d8494");
  mound.position.set(-0.5, 1.35, -0.9);
  g.add(mound);
  const shoulder = box(2.6, 1.6, 2.2, "#6f7686");
  shoulder.position.set(1.6, 1.0, -1.4);
  shoulder.rotation.y = 0.4;
  g.add(shoulder);

  const caveMat = mat("#17120c", { emissive: PALETTE.gold, emissiveIntensity: 0.55 });
  const cave = new Mesh(new BoxGeometry(1.9, 1.7, 0.5), caveMat);
  cave.position.set(-0.5, 1.05, 2.05);
  g.add(cave);

  for (const [px, pz, ry] of [
    [-2.6, 1.6, 0.5],
    [-2.2, -2.4, -0.3],
  ] as const) {
    const rock = box(1.2, 0.9, 1.0, "#767d8d");
    rock.position.set(px, 0.65, pz);
    rock.rotation.y = ry;
    g.add(rock);
  }

  const poleA = cylinder(0.1, 0.1, 2.6, PALETTE.darkWood);
  poleA.position.set(-2.0, 1.5, 2.4);
  const poleB = cylinder(0.1, 0.1, 2.6, PALETTE.darkWood);
  poleB.position.set(1.0, 1.5, 2.4);
  const bar = cylinder(0.09, 0.09, 3.4, PALETTE.darkWood);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(-0.5, 2.75, 2.4);
  g.add(poleA, poleB, bar);

  const HEAP = { x: 2.35, z: 1.7 };
  const coins: Mesh[] = [];
  const fx = new Fx(() => g.parent);

  function mineGold(amount: number): void {
    const n = Math.max(1, Math.min(3, Math.ceil(amount / 400)));
    for (let k = 0; k < n; k++) {
      const row = coins.length;
      const dx = (Math.random() - 0.5) * 0.85;
      const dz = (Math.random() - 0.5) * 0.85;
      const y = 0.45 + (row % 14) * 0.13;
      const coin = new Mesh(
        new CylinderGeometry(0.3, 0.3, 0.1, 12),
        mat(PALETTE.gold, { emissive: "#b8860b", emissiveIntensity: 0.4, metalness: 0.45, roughness: 0.35 }),
      );
      coin.castShadow = true;
      const from = new Vector3(spec.x - 0.5, 1.3, spec.z + 2.1);
      const to = new Vector3(spec.x + HEAP.x + dx, y, spec.z + HEAP.z + dz);
      fx.fly(coin, from, to, 1.9 + k * 0.3, 0.65, (m) => {
        m.position.set(HEAP.x + dx, y, HEAP.z + dz);
        m.rotation.x = (Math.random() - 0.5) * 0.4;
        m.rotation.z = (Math.random() - 0.5) * 0.4;
        g.add(m);
        coins.push(m);
        if (coins.length > 24) {
          const old = coins.shift()!;
          fx.fade(old, 0.5);
        }
      });
    }
  }

  let glowT = 0;

  return {
    key: "goldMine",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    mineGold,
    update(dt, elapsed) {
      glowT = Math.max(0, glowT - dt);
      caveMat.emissiveIntensity =
        0.5 + 0.22 * Math.sin(elapsed * 5.3) + (glowT > 0 ? 1.4 : 0);
      if (Math.ceil(elapsed * 0.7) !== Math.ceil((elapsed - dt) * 0.7)) glowT = 0.35;
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Elixir Collector — dollars spent. Bubbles rise from the vat; level sloshes.
// ---------------------------------------------------------------------------
function createElixir(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "elixir";
  g.position.set(spec.x, 0, spec.z);

  const slab = box(7, 0.4, 6, "#8a8f9c");
  slab.position.y = 0.2;
  g.add(slab);

  const tankShellMat = mat("#a9c8e8", {
    transparent: true,
    opacity: 0.4,
    roughness: 0.15,
    metalness: 0.1,
  });
  const shell = new Mesh(new CylinderGeometry(1.75, 1.75, 3.0, 18), tankShellMat);
  shell.position.set(-0.8, 1.9, -0.4);
  shell.castShadow = true;
  g.add(shell);

  const liquidMat = mat(PALETTE.elixir, {
    emissive: PALETTE.elixir,
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });
  const liquid = new Mesh(new CylinderGeometry(1.58, 1.58, 1, 18), liquidMat);
  liquid.position.set(-0.8, 0.5, -0.4);
  g.add(liquid);

  const cap = cylinder(1.85, 1.85, 0.3, "#6f7686");
  cap.position.set(-0.8, 3.5, -0.4);
  g.add(cap);

  const shed = box(2.6, 2.0, 2.4, "#e8dcc0");
  shed.position.set(2.1, 1.2, 1.2);
  g.add(shed);
  const shedRoof = pyramid(2.1, 1.3, "#7c4a2b");
  shedRoof.position.set(2.1, 2.85, 1.2);
  g.add(shedRoof);

  const pipe = cylinder(0.22, 0.22, 3.4, "#6f7686");
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0.6, 2.6, -0.1);
  g.add(pipe);

  const spout = cylinder(0.16, 0.16, 1.0, "#6f7686");
  spout.position.set(0.6, 1.4, 1.5);
  g.add(spout);

  const fx = new Fx(() => g.parent);
  let level = 0.5; // 0..1 of tank height
  let bump = 0;

  function collect(): void {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const bubble = new Mesh(
        new SphereGeometry(0.13 + Math.random() * 0.1, 10, 8),
        mat("#e6c4ff", { emissive: PALETTE.elixir, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }),
      );
      const from = new Vector3(
        spec.x - 0.8 + (Math.random() - 0.5) * 1.6,
        3.3,
        spec.z - 0.4 + (Math.random() - 0.5) * 1.6,
      );
      const to = from.clone().add(new Vector3((Math.random() - 0.5) * 0.6, 1.5 + Math.random(), (Math.random() - 0.5) * 0.6));
      fx.fly(bubble, from, to, 0.35, 0.9 + Math.random() * 0.4);
    }
    bump = 1;
  }

  return {
    key: "elixir",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    collect,
    update(dt, elapsed) {
      bump = Math.max(0, bump - dt * 1.8);
      const drain = (0.5 - level) * dt * 0.12;
      level = Math.min(0.9, level + drain + bump * dt * 1.6);
      const h = 0.5 + level * 2.3;
      liquid.scale.y = h;
      liquid.position.y = 0.42 + h / 2;
      liquidMat.emissiveIntensity = 0.45 + bump * 0.9 + 0.1 * Math.sin(elapsed * 3.7);
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Trophy Hall — completed tasks. A trophy flies onto the shelf each time.
// ---------------------------------------------------------------------------
function createTrophyHall(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "trophyHall";
  g.position.set(spec.x, 0, spec.z);

  const base = box(6.4, 0.5, 5.4, PALETTE.stone);
  base.position.y = 0.25;
  g.add(base);

  const walls = box(5.4, 2.8, 4.4, PALETTE.cream);
  walls.position.y = 1.9;
  g.add(walls);

  for (const x of [-2.1, -0.7, 0.7, 2.1]) {
    const col = cylinder(0.24, 0.28, 2.7, "#efe6d2");
    col.position.set(x, 1.85, 2.45);
    g.add(col);
  }

  const roof = box(6.7, 0.5, 5.7, "#4a7fd0");
  roof.position.y = 3.55;
  g.add(roof);
  const trimMat = mat(PALETTE.gold, { emissive: PALETTE.gold, emissiveIntensity: 0.2 });
  const trim = new Mesh(new BoxGeometry(5.7, 0.24, 4.7), trimMat);
  trim.position.y = 3.92;
  g.add(trim);

  const crest = pyramid(1.1, 1.3, PALETTE.gold);
  crest.position.y = 4.65;
  g.add(crest);

  const shelf = box(6.6, 0.28, 1.1, PALETTE.darkWood);
  shelf.position.set(0, 0.7, 3.7);
  g.add(shelf);
  for (const x of [-2.9, -1, 1, 2.9]) {
    const leg = box(0.3, 0.7, 0.8, "#5d4326");
    leg.position.set(x, 0.35, 3.7);
    g.add(leg);
  }

  const SLOT_COUNT = 8;
  const cups: Mesh[] = [];
  const fx = new Fx(() => g.parent);

  function cupMesh(): Mesh {
    const c = new Mesh(
      new CylinderGeometry(0.24, 0.1, 0.46, 10),
      mat(PALETTE.gold, { emissive: "#b8860b", emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.3 }),
    );
    c.castShadow = true;
    return c;
  }

  function addTrophy(): void {
    const idx = cups.length % SLOT_COUNT;
    if (cups.length >= SLOT_COUNT) {
      const victim = cups.shift()!;
      fx.fade(victim, 0.4);
    }
    const x = -2.8 + idx * 0.8;
    const cup = cupMesh();
    const from = new Vector3(spec.x, 7.5, spec.z);
    const to = new Vector3(spec.x + x, 1.06, spec.z + 3.7);
    fx.fly(cup, from, to, 2.4, 0.8, (m) => {
      m.position.set(x, 1.06, 3.7);
      m.rotation.y = (Math.random() - 0.5) * 0.6;
      g.add(m);
      cups.push(m);
    });
  }

  return {
    key: "trophyHall",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    addTrophy,
    update(dt, elapsed) {
      trimMat.emissiveIntensity = 0.2 + 0.12 * Math.sin(elapsed * 2.2);
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Clock Tower — the village heartbeat: gears turn, hands keep session time.
// ---------------------------------------------------------------------------
function createClockTower(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "clockTower";
  g.position.set(spec.x, 0, spec.z);

  const base = box(5, 0.5, 6, PALETTE.stone);
  base.position.y = 0.25;
  g.add(base);

  const shaft = box(3.4, 5.6, 3.4, "#e8dcc0");
  shaft.position.y = 3.3;
  g.add(shaft);

  const roof = pyramid(2.9, 2.0, PALETTE.roofBlue);
  roof.position.y = 7.1;
  g.add(roof);
  const vane = box(0.9, 0.5, 0.06, PALETTE.gold);
  vane.position.set(0.5, 8.4, 0);
  g.add(vane);

  const rim = cylinder(1.32, 1.32, 0.2, PALETTE.darkWood);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 5.1, 1.72);
  g.add(rim);
  const face = cylinder(1.16, 1.16, 0.24, "#f6f1e3");
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 5.1, 1.74);
  g.add(face);
  for (let i = 0; i < 12; i++) {
    const tick = box(0.07, 0.2, 0.06, "#2b3244");
    const a = (i / 12) * Math.PI * 2;
    tick.position.set(Math.sin(a) * 0.95, 5.1 + Math.cos(a) * 0.95, 1.88);
    tick.rotation.z = -a;
    g.add(tick);
  }

  const minutePivot = new Group();
  minutePivot.position.set(0, 5.1, 1.9);
  const minuteHand = box(0.09, 0.9, 0.06, "#2b3244");
  minuteHand.position.y = 0.38;
  minutePivot.add(minuteHand);
  const hourPivot = new Group();
  hourPivot.position.set(0, 5.1, 1.93);
  const hourHand = box(0.12, 0.6, 0.06, "#2b3244");
  hourHand.position.y = 0.26;
  hourPivot.add(hourHand);
  const hub = cylinder(0.1, 0.1, 0.1, PALETTE.gold);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 5.1, 1.96);
  g.add(minutePivot, hourPivot, hub);

  function gear(r: number, x: number, y: number, z: number, teeth: number): Group {
    const grp = new Group();
    grp.position.set(x, y, z);
    const wheel = cylinder(r, r, 0.2, "#8a8f9c", { metalness: 0.55, roughness: 0.4 });
    wheel.rotation.z = Math.PI / 2;
    grp.add(wheel);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const tooth = box(0.22, 0.3, 0.2, "#8a8f9c", { metalness: 0.55, roughness: 0.4 });
      tooth.position.set(0, Math.cos(a) * (r + 0.12), Math.sin(a) * (r + 0.12));
      tooth.rotation.x = -a;
      grp.add(tooth);
    }
    return grp;
  }

  const gearA = gear(0.8, 1.82, 3.4, -0.7, 10);
  const gearB = gear(0.58, 1.82, 4.7, 0.35, 8);
  const gearC = gear(0.42, 1.82, 3.6, 1.2, 7);
  g.add(gearA, gearB, gearC);

  return {
    key: "clockTower",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    update(dt, elapsed) {
      gearA.rotation.x += dt * 0.8;
      gearB.rotation.x -= dt * 1.12;
      gearC.rotation.x += dt * 1.55;
      minutePivot.rotation.z = -((elapsed % 60) / 60) * Math.PI * 2;
      hourPivot.rotation.z = -((elapsed % 720) / 720) * Math.PI * 2;
      vane.rotation.y = Math.sin(elapsed * 0.6) * 0.5;
    },
  };
}

// ---------------------------------------------------------------------------
// Mystery Hut — unknown / error / approval events. Crooked, glowing, twitchy.
// ---------------------------------------------------------------------------
function createMystery(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "mystery";
  g.position.set(spec.x, 0, spec.z);

  const body = new Group();
  g.add(body);

  const hut = box(3.4, 2.6, 3.2, "#3b2f52");
  hut.position.y = 1.4;
  hut.rotation.z = 0.07;
  body.add(hut);

  const roof = pyramid(2.9, 2.1, "#5a3d8c");
  roof.position.set(0.1, 3.5, 0);
  roof.rotation.z = 0.16;
  roof.rotation.y = 0.35;
  body.add(roof);

  const doorM = mat("#241c36", { emissive: "#7b4fd8", emissiveIntensity: 0.5 });
  const door = new Mesh(new BoxGeometry(0.3, 1.7, 1.1), doorM);
  door.position.set(1.72, 1.0, 0.4);
  body.add(door);

  const winMat = mat("#1c1730", { emissive: "#9d6cff", emissiveIntensity: 0.8 });
  const winA = new Mesh(new BoxGeometry(0.7, 0.7, 0.2), winMat);
  winA.position.set(-0.7, 1.8, 1.65);
  const winB = new Mesh(new BoxGeometry(0.2, 0.7, 0.7), winMat);
  winB.position.set(-1.75, 1.6, -0.5);
  body.add(winA, winB);

  const crystalMat = mat("#b388ff", { emissive: "#8a4fff", emissiveIntensity: 1.0 });
  const crystal = new Mesh(new OctahedronGeometry(0.55), crystalMat);
  crystal.position.set(0.1, 5.0, 0);
  crystal.castShadow = true;
  body.add(crystal);

  const fogMat = new MeshStandardMaterial({
    color: "#7b4fd8",
    emissive: "#7b4fd8",
    emissiveIntensity: 0.7,
    transparent: true,
    opacity: 0,
    roughness: 1,
  });
  const fog = new Mesh(new CircleGeometry(2.6, 28), fogMat);
  fog.rotation.x = -Math.PI / 2;
  fog.position.y = 0.06;
  g.add(fog);

  const runeMat = mat("#c9a6ff", { emissive: "#9d6cff", emissiveIntensity: 1.1 });
  const runes = [0, 1, 2].map(() => {
    const r = new Mesh(new BoxGeometry(0.3, 0.42, 0.08), runeMat);
    r.castShadow = false;
    g.add(r);
    return r;
  });

  const BASE_TILT = 0.07;
  let shudderT = -1;
  let shudderDur = 1;
  let fogT = -1;

  function pulse(duration = 1.6): void {
    shudderT = 0;
    shudderDur = duration;
    fogT = 0;
  }

  return {
    key: "mystery",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    pulse,
    update(dt, elapsed) {
      crystal.rotation.y += dt * 1.4;
      crystal.position.y = 5.0 + Math.sin(elapsed * 2.1) * 0.18;
      crystalMat.emissiveIntensity = 0.9 + 0.5 * Math.sin(elapsed * 3.3);
      winMat.emissiveIntensity = 0.6 + 0.35 * Math.sin(elapsed * 5.1 + 1.7);

      runes.forEach((r, i) => {
        const a = elapsed * 0.7 + (i * Math.PI * 2) / 3;
        r.position.set(Math.cos(a) * 1.9, 3.6 + Math.sin(elapsed * 1.8 + i) * 0.35, Math.sin(a) * 1.9);
        r.rotation.y = -a;
        r.rotation.z = Math.sin(elapsed * 2.4 + i) * 0.3;
      });

      if (shudderT >= 0) {
        shudderT += dt;
        const k = Math.max(0, 1 - shudderT / shudderDur);
        body.rotation.z = Math.sin(shudderT * 46) * 0.05 * k;
        hut.rotation.z = BASE_TILT + Math.sin(shudderT * 61) * 0.04 * k;
        runeMat.emissiveIntensity = 1.1 + 2.4 * k;
        if (shudderT >= shudderDur) {
          shudderT = -1;
          body.rotation.z = 0;
          hut.rotation.z = BASE_TILT;
          runeMat.emissiveIntensity = 1.1;
        }
      }

      if (fogT >= 0) {
        fogT += dt / 1.3;
        if (fogT >= 1) {
          fogT = -1;
          fogMat.opacity = 0;
          fog.scale.setScalar(1);
        } else {
          fog.scale.setScalar(1 + fogT * 1.7);
          fogMat.opacity = 0.5 * (1 - fogT);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Perimeter walls — instanced stone ring; also seals the nav grid.
// ---------------------------------------------------------------------------
export function createWalls(grid: NavGrid): Group {
  const root = new Group();
  root.name = "walls";

  type Placement = { x: number; z: number; rot: number };
  const placements: Placement[] = [];
  for (const s of WALLS) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 1.95));
    const rot = Math.atan2(-dz, dx);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      placements.push({ x: s.ax + dx * t, z: s.az + dz * t, rot });
    }
    // seal the nav grid with overlapping stamps along the segment
    const steps = Math.max(1, Math.ceil(len / 0.7));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = s.ax + dx * t;
      const pz = s.az + dz * t;
      grid.blockRect({ x0: px - 0.55, z0: pz - 0.55, x1: px + 0.55, z1: pz + 0.55 });
    }
  }

  const dummy = new Object3D();

  const blocks = new InstancedMesh(
    new BoxGeometry(1.9, 1.6, 1.05),
    mat(PALETTE.stone, { roughness: 0.95 }),
    placements.length,
  );
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 0.8, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.updateMatrix();
    blocks.setMatrixAt(i, dummy.matrix);
  });
  blocks.instanceMatrix.needsUpdate = true;
  root.add(blocks);

  const merlons = new InstancedMesh(
    new BoxGeometry(0.85, 0.55, 1.1),
    mat("#8a94a6", { roughness: 0.95 }),
    placements.length,
  );
  merlons.castShadow = true;
  placements.forEach((p, i) => {
    dummy.position.set(p.x, 1.87, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.updateMatrix();
    merlons.setMatrixAt(i, dummy.matrix);
  });
  merlons.instanceMatrix.needsUpdate = true;
  root.add(merlons);

  const towers = WALLS.map((s) => [s.ax, s.az] as const);
  const towerBases = new InstancedMesh(
    new CylinderGeometry(1.05, 1.2, 2.7, 10),
    mat(PALETTE.stone, { roughness: 0.95 }),
    towers.length,
  );
  towerBases.castShadow = true;
  const towerRoofs = new InstancedMesh(
    new ConeGeometry(1.4, 1.5, 8),
    mat(PALETTE.roofRed, { roughness: 0.85 }),
    towers.length,
  );
  towerRoofs.castShadow = true;
  towers.forEach(([x, z], i) => {
    dummy.position.set(x, 1.35, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    towerBases.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 3.45, z);
    dummy.updateMatrix();
    towerRoofs.setMatrixAt(i, dummy.matrix);
  });
  towerBases.instanceMatrix.needsUpdate = true;
  towerRoofs.instanceMatrix.needsUpdate = true;
  root.add(towerBases, towerRoofs);

  return root;
}

export function createBuilding(spec: BuildingSpec): BuildingInstance {
  switch (spec.key) {
    case "townHall":
      return createTownHall(spec);
    case "library":
      return createLibrary(spec);
    case "forge":
      return createForge(spec);
    case "barracks":
      return createBarracks(spec);
    case "archery":
      return createArchery(spec);
    case "goldMine":
      return createGoldMine(spec);
    case "elixir":
      return createElixir(spec);
    case "trophyHall":
      return createTrophyHall(spec);
    case "clockTower":
      return createClockTower(spec);
    case "mystery":
      return createMystery(spec);
  }
}
