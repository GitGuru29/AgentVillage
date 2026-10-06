import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import type { MeshStandardMaterialParameters } from "three";
import { PALETTE, PLAZA, type BuildingKey, type BuildingSpec } from "./layout";

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
  }
}
