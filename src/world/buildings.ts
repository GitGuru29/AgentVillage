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
  /** Command Center: screens flare while planning (also celebrations). */
  pulse?(duration?: number): void;
  /** Docs Archive: a document card flies out onto the pile. */
  spawnDoc?(): void;
  /** Dev Floor: glowing code cube arcs onto this agent's stack. */
  pushCode?(agentId: string): void;
  /** Dev Floor: stack collapses when its task completes. */
  resetStack?(agentId: string): void;
  /** Ops Bench: a CLI bot marches out and returns. */
  runTool?(tool: string, durationMs: number): void;
  /** QA Lab: green flag (pass) or scorch crater (fail). */
  testResult?(pass: boolean): void;
  /** Compute Cluster: data packets shower onto the heap per token batch. */
  rackLoad?(amount: number): void;
  /** Power & Billing: meter needle jumps for every dollar spent. */
  meterSpike?(cost: number): void;
  /** Release Wall: a version plaque lands on the board. */
  logRelease?(): void;
  /** Security Gate: barrier arm raises for a badge scan. */
  scanBadge?(): void;
  /** Debug Bay: breakpoints light up and the bug gets squashed. */
  debugBreak?(): void;
  /** Ship Dock: a cargo container loads onto the stack. */
  launchCargo?(): void;
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
// Command Center — the orchestrator. Screens flare while planning.
// ---------------------------------------------------------------------------
function createCommand(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "command";
  g.position.set(spec.x, 0, spec.z);

  const base = box(8, 1.0, 8, PALETTE.panelMid);
  base.position.y = 0.5;
  g.add(base);

  const body = box(6.6, 3.4, 6.6, PALETTE.panelDark);
  body.position.y = 2.7;
  g.add(body);

  const roofSlab = box(7.2, 0.5, 7.2, PALETTE.metal);
  roofSlab.position.y = 4.65;
  g.add(roofSlab);

  const door = box(1.6, 2.2, 0.35, PALETTE.panelMid);
  door.position.set(0, 2.1, 3.4);
  g.add(door);

  // screen wall on the south face
  const screenFrame = box(6.2, 1.8, 0.12, "#111726");
  screenFrame.position.set(0, 3.1, 3.34);
  g.add(screenFrame);
  const screenMat = mat("#0d1420", { emissive: PALETTE.screen, emissiveIntensity: 0.5 });
  for (const x of [-2.1, -0.7, 0.7, 2.1]) {
    const s = new Mesh(new BoxGeometry(1.2, 1.4, 0.18), screenMat);
    s.position.set(x, 3.1, 3.42);
    g.add(s);
  }

  // status strip along the base + rooftop antenna beacon
  const stripMat = mat("#0d1420", { emissive: PALETTE.amber, emissiveIntensity: 0.3 });
  const strip = new Mesh(new BoxGeometry(6.4, 0.18, 0.1), stripMat);
  strip.position.set(0, 1.2, 3.44);
  g.add(strip);

  const mast = cylinder(0.06, 0.06, 2.2, "#59617a");
  mast.position.y = 5.9;
  g.add(mast);
  const beaconMat = mat(PALETTE.alertRed, { emissive: PALETTE.alertRed, emissiveIntensity: 1.2 });
  const beacon = new Mesh(new SphereGeometry(0.16, 8, 6), beaconMat);
  beacon.position.y = 7.05;
  g.add(beacon);

  let glowT = 0;
  let glowLevel = 0.5;

  return {
    key: "command",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    pulse(duration = 2.4) {
      glowT = Math.max(glowT, duration);
    },
    update(dt, elapsed) {
      glowT = Math.max(0, glowT - dt);
      const target = glowT > 0 ? 1.6 + 0.6 * Math.sin(elapsed * 7) : 0.5;
      glowLevel += (target - glowLevel) * Math.min(1, dt * 8);
      screenMat.emissiveIntensity = glowLevel;
      stripMat.emissiveIntensity = 0.3 + glowLevel * 0.4;
      beaconMat.emissiveIntensity = 1.0 + 0.6 * Math.sin(elapsed * 3.1);
    },
  };
}

// ---------------------------------------------------------------------------
// Docs Archive — file reads/searches. Document cards pop onto a pile.
// ---------------------------------------------------------------------------
const DOC_COLORS = ["#e05252", "#4fc3f7", "#ffd23f", "#8bd450", "#b388ff", "#ff8a3d"];

function createDocs(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "docs";
  g.position.set(spec.x, 0, spec.z);

  const skirt = box(6.4, 0.4, 5.4, PALETTE.metal);
  skirt.position.y = 0.2;
  g.add(skirt);

  const walls = box(6, 2.8, 5, PALETTE.panelMid);
  walls.position.y = 1.8;
  g.add(walls);

  const roofSlab = box(6.4, 0.4, 5.4, PALETTE.panelDark);
  roofSlab.position.y = 3.4;
  g.add(roofSlab);

  const door = box(1.4, 1.9, 0.3, PALETTE.panelDark);
  door.position.set(0, 1.35, 2.55);
  g.add(door);

  // file-drawer fronts with colored tabs
  DOC_COLORS.forEach((c, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const drawer = box(1.4, 0.5, 0.16, "#1c2333");
    drawer.position.set(-1.75 + col * 1.75, 1.05 + row * 0.66, 2.55);
    g.add(drawer);
    const tab = box(0.4, 0.1, 0.06, c, { emissive: c, emissiveIntensity: 0.4 });
    tab.position.set(-1.75 + col * 1.75, 1.28 + row * 0.66, 2.65);
    g.add(tab);
  });

  const vent = cylinder(0.55, 0.55, 0.25, "#1c2333", {
    emissive: PALETTE.screen,
    emissiveIntensity: 0.3,
  });
  vent.rotation.z = Math.PI / 2;
  vent.position.set(3.05, 2.0, 0);
  g.add(vent);

  // Archive pile: pile-local coords == g-local minus the pile offset.
  const PILE = { x: -4.2, z: 3.0 };
  const pileDocs: Mesh[] = [];
  const fx = new Fx(() => g.parent);

  function spawnDoc(): void {
    const n = pileDocs.length;
    const color = DOC_COLORS[Math.floor(Math.random() * DOC_COLORS.length)]!;
    const doc = box(0.55, 0.07, 0.42, color);
    const dx = (Math.random() - 0.5) * 0.35;
    const dz = (Math.random() - 0.5) * 0.35;
    const y = 0.04 + n * 0.08;
    const from = new Vector3(spec.x, 1.7, spec.z + 3.0);
    const to = new Vector3(spec.x + PILE.x + dx, y, spec.z + PILE.z + dz);
    fx.fly(doc, from, to, 1.7, 0.7, (m) => {
      m.position.set(PILE.x + dx, y, PILE.z + dz);
      m.rotation.set(0, (Math.random() - 0.5) * 0.7, 0);
      g.add(m);
      pileDocs.push(m);
      if (pileDocs.length > 12) {
        const old = pileDocs.shift()!;
        fx.fade(old, 0.4);
      }
    });
  }

  return {
    key: "docs",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    spawnDoc,
    update(dt) {
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Dev Floor — code writes. Glowing code cubes fly out and stack per task.
// ---------------------------------------------------------------------------
const CODE_SLOTS: Array<[number, number]> = [
  [4.8, -1.4],
  [4.8, -0.1],
  [4.8, 1.2],
  [-4.8, -0.6],
];

function createDevFloor(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "devfloor";
  g.position.set(spec.x, 0, spec.z);

  const floor = box(6, 0.3, 5, PALETTE.panelMid);
  floor.position.y = 0.15;
  g.add(floor);

  const backWall = box(6, 2.6, 0.4, PALETTE.panelDark);
  backWall.position.set(0, 1.45, -2.3);
  g.add(backWall);

  const sideWall = box(0.4, 2.6, 5, PALETTE.panelDark);
  sideWall.position.set(-2.8, 1.45, 0);
  g.add(sideWall);

  const awning = box(6.2, 0.3, 1.3, PALETTE.metal);
  awning.position.set(0, 2.85, -1.9);
  g.add(awning);

  // desks with glowing monitors
  const monitorMat = mat("#0d1420", { emissive: PALETTE.screen, emissiveIntensity: 0.8 });
  for (const [dx, dz] of [
    [-1.6, 0.6],
    [0.4, 0.6],
    [2.2, -1.2],
  ] as const) {
    const deskTop = box(1.7, 0.14, 0.9, PALETTE.wood);
    deskTop.position.set(dx, 0.78, dz);
    g.add(deskTop);
    for (const lx of [dx - 0.7, dx + 0.7]) {
      const leg = box(0.12, 0.7, 0.7, "#20263a");
      leg.position.set(lx, 0.37, dz);
      g.add(leg);
    }
    const stand = box(0.14, 0.34, 0.14, "#20263a");
    stand.position.set(dx, 1.0, dz - 0.2);
    g.add(stand);
    const monitor = new Mesh(new BoxGeometry(1.0, 0.62, 0.08), monitorMat);
    monitor.position.set(dx, 1.42, dz - 0.24);
    g.add(monitor);
    const keyboard = box(0.8, 0.06, 0.3, "#151b2b");
    keyboard.position.set(dx, 0.88, dz + 0.2);
    g.add(keyboard);
  }

  // mini rack with status LED
  const miniRack = box(0.8, 1.4, 0.7, "#20263a");
  miniRack.position.set(-2.3, 0.85, -1.6);
  g.add(miniRack);
  const ledStrip = box(0.6, 0.08, 0.05, PALETTE.passGreen, {
    emissive: PALETTE.passGreen,
    emissiveIntensity: 0.9,
  });
  ledStrip.position.set(-2.3, 1.3, -1.24);
  g.add(ledStrip);

  type Stack = { owner: string; slot: number; count: number; bricks: Mesh[] };
  const stacks: Stack[] = [];
  const fx = new Fx(() => g.parent);

  function stackFor(agentId: string): Stack {
    const existing = stacks.find((s) => s.owner === agentId);
    if (existing) return existing;
    if (stacks.length < CODE_SLOTS.length) {
      const s: Stack = { owner: agentId, slot: stacks.length, count: 0, bricks: [] };
      stacks.push(s);
      return s;
    }
    // Steal the oldest slot: its stack crumbles first.
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

  function pushCode(agentId: string): void {
    const s = stackFor(agentId);
    if (s.count >= 14) clearStack(s);
    const [sx, sz] = CODE_SLOTS[s.slot]!;
    const y = 0.18 + s.count * 0.37;
    s.count++;
    const dx = (Math.random() - 0.5) * 0.12;
    const dz = (Math.random() - 0.5) * 0.1;
    const brick = box(0.78, 0.36, 0.52, PALETTE.screen, {
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
    key: "devfloor",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    pushCode,
    resetStack,
    update(dt, elapsed) {
      monitorMat.emissiveIntensity = 0.7 + 0.3 * Math.sin(elapsed * 4.2) + 0.12 * Math.sin(elapsed * 13);
      ledStrip.rotation.y = Math.sin(elapsed * 0.6) * 0.4;
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Ops Bench — tool calls. CLI bots march out and return.
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

function createOps(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "ops";
  g.position.set(spec.x, 0, spec.z);

  const floor = box(6, 0.3, 5, PALETTE.panelMid);
  floor.position.y = 0.15;
  g.add(floor);

  const backWall = box(6, 2.6, 0.4, PALETTE.panelDark);
  backWall.position.set(0, 1.45, -2.1);
  g.add(backWall);

  const sideWall = box(0.4, 2.6, 5, PALETTE.panelDark);
  sideWall.position.set(-2.8, 1.45, 0);
  g.add(sideWall);

  const awning = box(6.2, 0.3, 1.3, PALETTE.metal);
  awning.position.set(0, 2.85, -1.7);
  g.add(awning);

  const door = box(1.5, 2.0, 0.3, PALETTE.panelMid);
  door.position.set(0, 1.0, 2.55);
  g.add(door);

  // status screen next to the door
  const panelMat = mat("#111726", { emissive: PALETTE.passGreen, emissiveIntensity: 0.4 });
  const panel = new Mesh(new BoxGeometry(1.0, 1.4, 0.12), panelMat);
  panel.position.set(2.0, 1.7, 2.62);
  g.add(panel);

  // tool rack on the back wall
  Object.values(TOOL_COLORS).forEach((c, i) => {
    const tool = box(0.28, 0.55, 0.1, c, { emissive: c, emissiveIntensity: 0.25 });
    tool.position.set(-2.2 + i * 0.75, 1.9, -1.85);
    g.add(tool);
  });

  // workbench with a vise
  const bench = box(3.2, 0.9, 1.0, PALETTE.wood);
  bench.position.set(0.6, 0.6, 1.0);
  g.add(bench);
  const vise = box(0.5, 0.4, 0.4, "#3b3f4a", { metalness: 0.5, roughness: 0.5 });
  vise.position.set(1.7, 1.25, 1.0);
  g.add(vise);

  type Unit = { group: Group; legs: Mesh[]; t: number; dur: number };
  const units: Unit[] = [];
  const dir = new Vector3(PLAZA.x - spec.x, 0, PLAZA.z - spec.doorZ).normalize();

  function runTool(tool: string, durationMs: number): void {
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
    key: "ops",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    runTool,
    update(dt, elapsed) {
      panelMat.emissiveIntensity = 0.35 + 0.2 * Math.sin(elapsed * 2.6);
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
// QA Lab — tests. Green flag on pass, scorch crater + crash orb on fail.
// ---------------------------------------------------------------------------
function createQA(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "qa";
  g.position.set(spec.x, 0, spec.z);

  const platform = box(7, 0.35, 5, PALETTE.metal);
  platform.position.y = 0.175;
  g.add(platform);

  const frameMat = mat("#111726");
  const rigMat = mat(PALETTE.screen, { emissive: PALETTE.screen, emissiveIntensity: 0.55 });
  for (const x of [-2.2, 0, 2.2]) {
    const post = box(0.15, 1.3, 0.15, "#20263a");
    post.position.set(x, 1.0, -1.3);
    g.add(post);
    const outer = new Mesh(new CylinderGeometry(0.72, 0.72, 0.26, 18), frameMat);
    outer.rotation.x = Math.PI / 2;
    outer.position.set(x, 1.62, -1.3);
    outer.castShadow = true;
    const inner = new Mesh(new CylinderGeometry(0.34, 0.34, 0.3, 18), rigMat);
    inner.rotation.x = Math.PI / 2;
    inner.position.set(x, 1.62, -1.28);
    g.add(outer, inner);
  }

  for (const x of [-2.9, 2.9]) {
    const crate = box(1.1, 0.9, 1.0, "#39435a");
    crate.position.set(x, 0.8, 1.4);
    crate.rotation.y = x > 0 ? 0.3 : -0.4;
    g.add(crate);
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
    color: "#1e1410",
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
  let flashT = -1;
  let flashPass = true;

  function testResult(pass: boolean): void {
    flashT = 0;
    flashPass = pass;
    if (pass) {
      flagMat.color.set(PALETTE.passGreen);
      flagT = 0;
    } else {
      crater.visible = true;
      craterMat.opacity = 1;
      craterT = 0;
      const orb = new Mesh(new SphereGeometry(0.5, 14, 12), mat(PALETTE.failRed));
      orb.castShadow = true;
      const from = new Vector3(spec.x + 3.5, 7, spec.z + 9);
      const to = new Vector3(spec.x + 0.5, 0.5, spec.z + 3.6);
      fx.fly(orb, from, to, 0.5, 0.55, (m) => {
        m.position.set(0.5, 0.5, 3.6);
        g.add(m);
        fx.fade(m, 5.5);
      });
    }
  }

  return {
    key: "qa",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    testResult,
    update(dt, elapsed) {
      fx.update(dt);

      if (flashT >= 0) {
        flashT += dt;
        if (flashT < 3) {
          const c = flashPass ? PALETTE.passGreen : PALETTE.failRed;
          rigMat.color.set(c);
          rigMat.emissive.set(c);
          rigMat.emissiveIntensity = 1.7 - 0.3 * flashT;
        } else {
          rigMat.color.set(PALETTE.screen);
          rigMat.emissive.set(PALETTE.screen);
          rigMat.emissiveIntensity = 0.55;
          flashT = -1;
        }
      }

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
// Compute Cluster — token usage. Data packets shower onto the heap.
// ---------------------------------------------------------------------------
function createRacks(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "racks";
  g.position.set(spec.x, 0, spec.z);

  const slab = box(7, 0.4, 6, "#2a303c");
  slab.position.y = 0.2;
  g.add(slab);

  // server racks along the back with LED banks
  const ledMats: MeshStandardMaterial[] = [];
  for (const x of [-2.55, -0.85, 0.85, 2.55]) {
    const rack = box(1.3, 2.9, 1.1, "#20263a");
    rack.position.set(x, 1.65, -1.9);
    g.add(rack);
    const face = box(1.1, 2.5, 0.1, "#151b2b");
    face.position.set(x, 1.65, -1.32);
    g.add(face);
    for (let r = 0; r < 5; r++) {
      const on = r % 2 === 0 ? PALETTE.amber : PALETTE.passGreen;
      const ledMat = mat(on, { emissive: on, emissiveIntensity: 0.8 });
      const led = new Mesh(new BoxGeometry(0.9, 0.1, 0.06), ledMat);
      led.position.set(x, 0.75 + r * 0.45, -1.25);
      g.add(led);
      ledMats.push(ledMat);
    }
  }

  // cable tray over the racks
  const tray = cylinder(0.12, 0.12, 5.6, "#151b2b");
  tray.rotation.z = Math.PI / 2;
  tray.position.set(0, 3.3, -1.9);
  g.add(tray);

  // packet feed port on the front edge
  const portMat = mat("#0d1420", { emissive: PALETTE.screen, emissiveIntensity: 0.8 });
  const port = new Mesh(new BoxGeometry(0.7, 0.7, 0.18), portMat);
  port.position.set(-0.5, 1.4, 2.95);
  g.add(port);

  const HEAP = { x: 2.35, z: 1.7 };
  const packets: Mesh[] = [];
  const fx = new Fx(() => g.parent);

  function rackLoad(amount: number): void {
    const n = Math.max(1, Math.min(3, Math.ceil(amount / 400)));
    for (let k = 0; k < n; k++) {
      const row = packets.length;
      const dx = (Math.random() - 0.5) * 0.85;
      const dz = (Math.random() - 0.5) * 0.85;
      const y = 0.45 + (row % 14) * 0.13;
      const packet = box(0.4, 0.18, 0.4, PALETTE.amber, {
        emissive: "#b8860b",
        emissiveIntensity: 0.7,
        metalness: 0.3,
        roughness: 0.4,
      });
      packet.castShadow = true;
      const from = new Vector3(spec.x - 0.5, 1.4, spec.z + 3.0);
      const to = new Vector3(spec.x + HEAP.x + dx, y, spec.z + HEAP.z + dz);
      fx.fly(packet, from, to, 1.9 + k * 0.3, 0.65, (m) => {
        m.position.set(HEAP.x + dx, y, HEAP.z + dz);
        m.rotation.x = (Math.random() - 0.5) * 0.4;
        m.rotation.z = (Math.random() - 0.5) * 0.4;
        g.add(m);
        packets.push(m);
        if (packets.length > 24) {
          const old = packets.shift()!;
          fx.fade(old, 0.5);
        }
      });
    }
  }

  let glowT = 0;

  return {
    key: "racks",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    rackLoad,
    update(dt, elapsed) {
      glowT = Math.max(0, glowT - dt);
      if (Math.ceil(elapsed * 0.7) !== Math.ceil((elapsed - dt) * 0.7)) glowT = 0.35;
      portMat.emissiveIntensity = 0.7 + 0.3 * Math.sin(elapsed * 6.1) + (glowT > 0 ? 0.9 : 0);
      ledMats.forEach((m, i) => {
        m.emissiveIntensity =
          0.55 + 0.3 * Math.sin(elapsed * (2.2 + (i % 5) * 0.7) + i) + (glowT > 0 ? 0.9 : 0);
      });
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Power & Billing — dollars spent. Battery level shows; meter needle jumps.
// ---------------------------------------------------------------------------
function createPower(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "power";
  g.position.set(spec.x, 0, spec.z);

  const slab = box(7, 0.4, 6, "#2a303c");
  slab.position.y = 0.2;
  g.add(slab);

  // battery bank with charge bars
  const batt = box(2.6, 2.8, 1.8, "#20263a");
  batt.position.set(-1.6, 1.6, -0.9);
  g.add(batt);
  const battCap = box(2.8, 0.3, 2.0, "#151b2b");
  battCap.position.set(-1.6, 3.1, -0.9);
  g.add(battCap);
  const barMats: MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const bm = mat(PALETTE.teal, { emissive: PALETTE.teal, emissiveIntensity: 0.9 });
    const bar = new Mesh(new BoxGeometry(1.8, 0.22, 0.1), bm);
    bar.position.set(-1.6, 0.7 + i * 0.5, 0.02);
    g.add(bar);
    barMats.push(bm);
  }

  // utility meter with a needle
  const meterBox = box(1.3, 1.7, 0.6, "#20263a");
  meterBox.position.set(1.9, 1.05, 1.6);
  g.add(meterBox);
  const dial = cylinder(0.5, 0.5, 0.12, "#0d1420", { emissive: PALETTE.teal, emissiveIntensity: 0.25 });
  dial.rotation.x = Math.PI / 2;
  dial.position.set(1.9, 1.4, 1.94);
  g.add(dial);
  const needlePivot = new Group();
  needlePivot.position.set(1.9, 1.4, 2.02);
  const needle = box(0.06, 0.42, 0.05, PALETTE.failRed);
  needle.position.y = 0.18;
  needlePivot.add(needle);
  g.add(needlePivot);
  const hub = cylinder(0.07, 0.07, 0.08, "#d8d8e0");
  hub.rotation.x = Math.PI / 2;
  hub.position.set(1.9, 1.4, 2.06);
  g.add(hub);

  // conduit from the battery to the meter
  const pipe = cylinder(0.18, 0.18, 2.4, "#151b2b");
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0.4, 2.5, 0.4);
  g.add(pipe);

  const fx = new Fx(() => g.parent);
  let level = 0.5; // 0..1 charge
  let bump = 0;

  function meterSpike(cost: number): void {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < n; k++) {
      const spark = box(0.14, 0.14, 0.14, PALETTE.teal, {
        emissive: PALETTE.teal,
        emissiveIntensity: 1.3,
      });
      const from = new Vector3(spec.x + 1.9, 2.0, spec.z + 1.8);
      const to = from.clone().add(
        new Vector3((Math.random() - 0.5) * 0.8, 1.4 + Math.random(), (Math.random() - 0.5) * 0.8),
      );
      fx.fly(spark, from, to, 0.2, 0.5 + Math.random() * 0.3);
    }
    bump = 1;
  }

  return {
    key: "power",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    meterSpike,
    update(dt, elapsed) {
      bump = Math.max(0, bump - dt * 1.8);
      const drain = (0.5 - level) * dt * 0.12;
      level = Math.min(0.9, level + drain + bump * dt * 1.6);

      needlePivot.rotation.z =
        -0.85 + level * 1.6 + (bump > 0.15 ? Math.sin(elapsed * 40) * bump * 0.3 : 0);
      barMats.forEach((m, i) => {
        const on = i / 5 < level;
        m.emissiveIntensity = on ? 0.8 + 0.25 * Math.sin(elapsed * 3 + i) : 0.05;
      });
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Release Wall — completed tasks. A version plaque lands on the board.
// ---------------------------------------------------------------------------
const PLAQUE_COLORS = ["#ffb84d", "#7ef0ff", "#4fd67a", "#4fe3c1", "#e05252", "#b388ff"];

function createRelease(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "release";
  g.position.set(spec.x, 0, spec.z);

  const base = box(6.4, 0.5, 5.4, PALETTE.panelMid);
  base.position.y = 0.25;
  g.add(base);

  const walls = box(5.4, 2.8, 4.4, PALETTE.panelDark);
  walls.position.y = 1.9;
  g.add(walls);

  // release board on the south face
  const board = box(4.8, 2.0, 0.14, "#111726");
  board.position.set(0, 1.9, 2.32);
  g.add(board);
  const headerMat = mat(PALETTE.amber, { emissive: PALETTE.amber, emissiveIntensity: 0.35 });
  const header = new Mesh(new BoxGeometry(4.8, 0.3, 0.1), headerMat);
  header.position.set(0, 3.05, 2.34);
  g.add(header);

  const roof = box(6.7, 0.5, 5.7, PALETTE.metal);
  roof.position.y = 3.55;
  g.add(roof);
  const trimMat = mat(PALETTE.screen, { emissive: PALETTE.screen, emissiveIntensity: 0.2 });
  const trim = new Mesh(new BoxGeometry(5.7, 0.24, 4.7), trimMat);
  trim.position.y = 3.92;
  g.add(trim);

  const mast = cylinder(0.06, 0.06, 1.5, "#59617a");
  mast.position.y = 4.9;
  g.add(mast);

  const SLOT_COUNT = 8;
  const plaques: Mesh[] = [];
  const fx = new Fx(() => g.parent);
  let releaseN = 0;

  function logRelease(): void {
    const idx = plaques.length % SLOT_COUNT;
    if (plaques.length >= SLOT_COUNT) {
      const victim = plaques.shift()!;
      fx.fade(victim, 0.4);
    }
    const x = -2.45 + idx * 0.7;
    const color = PLAQUE_COLORS[releaseN++ % PLAQUE_COLORS.length]!;
    const plaque = box(0.6, 0.5, 0.1, color, {
      emissive: color,
      emissiveIntensity: 0.35,
    });
    const from = new Vector3(spec.x, 7.5, spec.z);
    const to = new Vector3(spec.x + x, 1.9, spec.z + 2.44);
    fx.fly(plaque, from, to, 2.4, 0.8, (m) => {
      m.position.set(x, 1.9, 2.44);
      m.rotation.y = (Math.random() - 0.5) * 0.2;
      g.add(m);
      plaques.push(m);
    });
  }

  return {
    key: "release",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    logRelease,
    update(dt, elapsed) {
      trimMat.emissiveIntensity = 0.2 + 0.12 * Math.sin(elapsed * 2.2);
      headerMat.emissiveIntensity = 0.3 + 0.15 * Math.sin(elapsed * 3.1 + 1);
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// NOC Monitors — ops dashboard: gauges, status lights, cooling fans.
// ---------------------------------------------------------------------------
function createNOC(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "noc";
  g.position.set(spec.x, 0, spec.z);

  const base = box(5, 0.5, 6, PALETTE.panelMid);
  base.position.y = 0.25;
  g.add(base);

  const shaft = box(3.6, 5.4, 3.6, PALETTE.panelDark);
  shaft.position.y = 3.2;
  g.add(shaft);

  const roofSlab = box(4.0, 0.4, 4.0, PALETTE.metal);
  roofSlab.position.y = 6.1;
  g.add(roofSlab);

  const mast = cylinder(0.07, 0.07, 1.8, "#59617a");
  mast.position.y = 7.1;
  g.add(mast);
  const beaconMat = mat(PALETTE.alertRed, { emissive: PALETTE.alertRed, emissiveIntensity: 1.2 });
  const beacon = new Mesh(new SphereGeometry(0.15, 8, 6), beaconMat);
  beacon.position.y = 8.05;
  g.add(beacon);

  // dashboard screen on the south face
  const screenFrame = box(2.6, 1.9, 0.12, "#111726");
  screenFrame.position.set(-0.4, 4.5, 1.86);
  g.add(screenFrame);
  const screenMat = mat("#0d1420", { emissive: PALETTE.screen, emissiveIntensity: 0.55 });
  const screen = new Mesh(new BoxGeometry(2.3, 1.6, 0.14), screenMat);
  screen.position.set(-0.4, 4.5, 1.92);
  g.add(screen);

  // gauge column beside the screen
  const needlePivots: Group[] = [];
  for (const [i, y] of [5.2, 4.45, 3.7].entries()) {
    const rim = cylinder(0.38, 0.38, 0.1, "#151b2b");
    rim.rotation.x = Math.PI / 2;
    rim.position.set(1.15, y, 1.87);
    g.add(rim);
    const faceM = mat("#0d1420", {
      emissive: i === 0 ? PALETTE.amber : PALETTE.screen,
      emissiveIntensity: 0.35,
    });
    const face = new Mesh(new CylinderGeometry(0.3, 0.3, 0.12, 14), faceM);
    face.rotation.x = Math.PI / 2;
    face.position.set(1.15, y, 1.9);
    g.add(face);
    const pivot = new Group();
    pivot.position.set(1.15, y, 1.98);
    const needle = box(0.05, 0.26, 0.04, PALETTE.failRed);
    needle.position.y = 0.1;
    pivot.add(needle);
    g.add(pivot);
    needlePivots.push(pivot);
  }

  // status lights on the east face
  const lightMats: MeshStandardMaterial[] = [];
  for (const [i, c] of [PALETTE.passGreen, PALETTE.amber, PALETTE.failRed, PALETTE.screen].entries()) {
    const lm = mat(c, { emissive: c, emissiveIntensity: 1 });
    const l = new Mesh(new SphereGeometry(0.12, 8, 6), lm);
    l.position.set(1.86, 5.6 - i * 0.7, 0.6);
    g.add(l);
    lightMats.push(lm);
  }

  // cooling fans on the south face
  const spinners: Group[] = [];
  for (const [fx2, fy] of [
    [-0.9, 2.2],
    [0.4, 1.3],
  ] as const) {
    const ring = cylinder(0.52, 0.52, 0.08, "#151b2b");
    ring.rotation.x = Math.PI / 2;
    ring.position.set(fx2, fy, 1.87);
    g.add(ring);
    const spin = new Group();
    spin.position.set(fx2, fy, 1.93);
    for (let b = 0; b < 4; b++) {
      const blade = box(0.4, 0.1, 0.05, "#39435a");
      blade.position.set(Math.cos((b * Math.PI) / 2) * 0.22, Math.sin((b * Math.PI) / 2) * 0.22, 0);
      blade.rotation.z = (b * Math.PI) / 2 + 0.5;
      spin.add(blade);
    }
    g.add(spin);
    spinners.push(spin);
  }

  return {
    key: "noc",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    update(dt, elapsed) {
      spinners.forEach((s, i) => {
        s.rotation.z += dt * (2.4 + i * 1.1);
      });
      needlePivots.forEach((p, i) => {
        p.rotation.z = Math.sin(elapsed * (0.7 + i * 0.35) + i * 1.7) * 0.9;
      });
      lightMats.forEach((m, i) => {
        m.emissiveIntensity = 0.7 + 0.6 * Math.sin(elapsed * 2.2 + i * 1.3);
      });
      screenMat.emissiveIntensity = 0.5 + 0.22 * Math.sin(elapsed * 4.1) + 0.1 * Math.sin(elapsed * 11);
      beaconMat.emissiveIntensity = 1.0 + 0.6 * Math.sin(elapsed * 3.3);
    },
  };
}

// ---------------------------------------------------------------------------
// Incident Room — errors and unknown events. Red strobe, twitchy, glowing.
// ---------------------------------------------------------------------------
function createIncident(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "incident";
  g.position.set(spec.x, 0, spec.z);

  const body = new Group();
  g.add(body);

  const hut = box(3.4, 2.6, 3.2, "#2a1c22");
  hut.position.y = 1.4;
  hut.rotation.z = 0.07;
  body.add(hut);

  const roof = pyramid(2.9, 2.1, "#41242c");
  roof.position.set(0.1, 3.5, 0);
  roof.rotation.z = 0.16;
  roof.rotation.y = 0.35;
  body.add(roof);

  const doorM = mat("#1c1216", { emissive: PALETTE.alertRed, emissiveIntensity: 0.5 });
  const door = new Mesh(new BoxGeometry(0.3, 1.7, 1.1), doorM);
  door.position.set(1.72, 1.0, 0.4);
  body.add(door);

  const winMat = mat("#1a1014", { emissive: PALETTE.alertRed, emissiveIntensity: 0.8 });
  const winA = new Mesh(new BoxGeometry(0.7, 0.7, 0.2), winMat);
  winA.position.set(-0.7, 1.8, 1.65);
  const winB = new Mesh(new BoxGeometry(0.2, 0.7, 0.7), winMat);
  winB.position.set(-1.75, 1.6, -0.5);
  body.add(winA, winB);

  // rooftop alert beacon
  const crystalMat = mat(PALETTE.alertRed, { emissive: PALETTE.alertRed, emissiveIntensity: 1.0 });
  const crystal = new Mesh(new OctahedronGeometry(0.55), crystalMat);
  crystal.position.set(0.1, 5.0, 0);
  crystal.castShadow = true;
  body.add(crystal);

  const fogMat = new MeshStandardMaterial({
    color: PALETTE.alertRed,
    emissive: PALETTE.alertRed,
    emissiveIntensity: 0.7,
    transparent: true,
    opacity: 0,
    roughness: 1,
  });
  const fog = new Mesh(new CircleGeometry(2.6, 28), fogMat);
  fog.rotation.x = -Math.PI / 2;
  fog.position.y = 0.06;
  g.add(fog);

  const runeMat = mat("#ffd23f", { emissive: PALETTE.amber, emissiveIntensity: 1.1 });
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
    key: "incident",
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
// Security Gate — approvals & security scans. Barrier arm + badge reader.
// ---------------------------------------------------------------------------
function createGate(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "gate";
  g.position.set(spec.x, 0, spec.z);

  const pad = box(5, 0.3, 5, PALETTE.panelMid);
  pad.position.y = 0.15;
  g.add(pad);

  // guard booth
  const booth = box(1.5, 2.2, 1.5, PALETTE.panelDark);
  booth.position.set(-1.4, 1.25, -0.9);
  g.add(booth);
  const boothWin = box(0.9, 0.7, 0.1, "#0d1420", {
    emissive: PALETTE.screen,
    emissiveIntensity: 0.55,
  });
  boothWin.position.set(-1.4, 1.6, -0.12);
  g.add(boothWin);
  const roofCap = box(1.8, 0.3, 1.8, PALETTE.metal);
  roofCap.position.set(-1.4, 2.5, -0.9);
  g.add(roofCap);
  const sign = box(0.9, 0.6, 0.08, PALETTE.amber, {
    emissive: PALETTE.amber,
    emissiveIntensity: 0.3,
  });
  sign.position.set(-1.4, 2.05, -0.06);
  g.add(sign);

  // badge scanner post
  const scanner = box(0.5, 1.5, 0.5, "#20263a");
  scanner.position.set(1.5, 0.9, 1.2);
  g.add(scanner);
  const lightMat = mat(PALETTE.passGreen, { emissive: PALETTE.passGreen, emissiveIntensity: 1.0 });
  const light = new Mesh(new SphereGeometry(0.2, 10, 8), lightMat);
  light.position.set(1.5, 1.8, 1.2);
  g.add(light);
  const readerMat = mat("#0d1420", { emissive: PALETTE.teal, emissiveIntensity: 0.7 });
  const reader = new Mesh(new BoxGeometry(0.34, 0.44, 0.1), readerMat);
  reader.position.set(1.5, 1.1, 1.5);
  g.add(reader);

  // barrier arm across the south edge
  const pivotPost = cylinder(0.14, 0.16, 1.1, "#59617a");
  pivotPost.position.set(-2.3, 0.55, 2.1);
  g.add(pivotPost);
  const barrierPivot = new Group();
  barrierPivot.position.set(-2.3, 1.0, 2.1);
  const arm = new Mesh(new BoxGeometry(4.2, 0.18, 0.22), mat("#e8ecf4"));
  arm.position.x = 2.1;
  for (let i = 0; i < 4; i++) {
    const stripe = box(0.5, 0.2, 0.24, PALETTE.alertRed);
    stripe.position.x = -1.6 + i * 1.0;
    arm.add(stripe);
  }
  barrierPivot.add(arm);
  g.add(barrierPivot);

  let scanT = -1;

  function scanBadge(): void {
    scanT = 0;
  }

  return {
    key: "gate",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    scanBadge,
    update(dt, elapsed) {
      if (scanT >= 0) {
        scanT += dt;
        const RAISE = 0.45;
        const HOLD = 1.7;
        const LOWER = 0.55;
        if (scanT < RAISE) {
          barrierPivot.rotation.z = (scanT / RAISE) * 1.15;
        } else if (scanT < RAISE + HOLD) {
          barrierPivot.rotation.z = 1.15;
        } else if (scanT < RAISE + HOLD + LOWER) {
          const k = (scanT - RAISE - HOLD) / LOWER;
          barrierPivot.rotation.z = 1.15 * (1 - k);
        } else {
          barrierPivot.rotation.z = 0;
          scanT = -1;
          lightMat.color.set(PALETTE.passGreen);
          lightMat.emissive.set(PALETTE.passGreen);
        }
        if (scanT >= 0) {
          lightMat.color.set(PALETTE.amber);
          lightMat.emissive.set(PALETTE.amber);
          lightMat.emissiveIntensity = 1.1 + 0.7 * Math.sin(scanT * 18);
          readerMat.emissiveIntensity = 1.4 + 0.6 * Math.sin(scanT * 14);
        }
      } else {
        lightMat.emissiveIntensity = 0.9 + 0.35 * Math.sin(elapsed * 2.4);
        readerMat.emissiveIntensity = 0.6 + 0.25 * Math.sin(elapsed * 3.1 + 1.4);
        barrierPivot.rotation.z = 0;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Debug Bay — debug sessions. Breakpoints light up, bug gets squashed.
// ---------------------------------------------------------------------------
function createDebug(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "debug";
  g.position.set(spec.x, 0, spec.z);

  const pad = box(5, 0.3, 5, PALETTE.panelMid);
  pad.position.y = 0.15;
  g.add(pad);

  const backWall = box(5, 2.4, 0.4, PALETTE.panelDark);
  backWall.position.set(0, 1.35, -2.1);
  g.add(backWall);

  const awning = box(5.2, 0.3, 1.3, PALETTE.metal);
  awning.position.set(0, 2.65, -1.8);
  g.add(awning);

  // debugger screen on the back wall
  const screenFrame = box(3.0, 1.7, 0.12, "#111726");
  screenFrame.position.set(0, 1.7, -1.86);
  g.add(screenFrame);
  const screenMat = mat("#0d1420", { emissive: PALETTE.failRed, emissiveIntensity: 0.45 });
  const screen = new Mesh(new BoxGeometry(2.7, 1.4, 0.14), screenMat);
  screen.position.set(0, 1.7, -1.8);
  g.add(screen);

  // trace lines on the screen
  const traceMat = mat(PALETTE.failRed, { emissive: PALETTE.failRed, emissiveIntensity: 0.9 });
  for (let i = 0; i < 4; i++) {
    const line = new Mesh(new BoxGeometry(1.9 - i * 0.3, 0.1, 0.05), traceMat);
    line.position.set(-0.3, 2.1 - i * 0.3, -1.72);
    g.add(line);
  }

  // desk with keyboard
  const deskTop = box(2.8, 0.14, 1.0, PALETTE.wood);
  deskTop.position.set(0, 0.78, 0.4);
  g.add(deskTop);
  for (const lx of [-1.2, 1.2]) {
    const leg = box(0.12, 0.7, 0.8, "#20263a");
    leg.position.set(lx, 0.37, 0.4);
    g.add(leg);
  }
  const keyboard = box(0.9, 0.06, 0.34, "#151b2b");
  keyboard.position.set(0, 0.88, 0.5);
  g.add(keyboard);

  // breakpoint dots along the back wall
  const dotMats: MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const dm = mat(PALETTE.alertRed, { emissive: PALETTE.alertRed, emissiveIntensity: 0.25 });
    const dot = new Mesh(new SphereGeometry(0.1, 8, 6), dm);
    dot.position.set(-1.6 + i * 0.8, 2.5, -1.78);
    g.add(dot);
    dotMats.push(dm);
  }

  // the bug on the desk
  const bug = new Group();
  const bugBody = box(0.4, 0.26, 0.3, "#3a2a16");
  const eyeA = box(0.07, 0.07, 0.05, PALETTE.failRed, {
    emissive: PALETTE.failRed,
    emissiveIntensity: 1.2,
  });
  eyeA.position.set(-0.1, 0.06, 0.16);
  const eyeB = eyeA.clone() as Mesh;
  eyeB.position.x = 0.1;
  bug.add(bugBody, eyeA, eyeB);
  bug.position.set(0.6, 1.05, 0.4);
  bug.visible = false;
  g.add(bug);

  let breakT = -1;

  function debugBreak(): void {
    breakT = 0;
    bug.visible = true;
    bug.scale.setScalar(1);
  }

  return {
    key: "debug",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    debugBreak,
    update(dt, elapsed) {
      if (breakT >= 0) {
        breakT += dt;
        // breakpoints light up one by one
        dotMats.forEach((m, i) => {
          m.emissiveIntensity = breakT > i * 0.22 && breakT < 3.4 ? 1.8 : 0.25;
        });
        // screen flickers while paused, then calms down
        screenMat.emissiveIntensity =
          breakT < 2.2 ? 1.1 + 0.5 * Math.sin(breakT * 34) : 0.45;
        traceMat.emissiveIntensity = breakT < 2.2 ? 1.6 : 0.9;
        // the bug gets squashed partway through
        if (breakT > 1.2 && breakT < 2.0) {
          bug.scale.setScalar(Math.max(0.01, 1 - (breakT - 1.2) / 0.8));
        } else if (breakT >= 2.0) {
          bug.visible = false;
        }
        if (breakT >= 4) {
          breakT = -1;
          dotMats.forEach((m) => (m.emissiveIntensity = 0.25));
        }
      } else {
        dotMats.forEach((m, i) => {
          m.emissiveIntensity = 0.2 + 0.15 * Math.sin(elapsed * 1.8 + i * 1.2);
        });
        screenMat.emissiveIntensity = 0.4 + 0.15 * Math.sin(elapsed * 3.3);
      }
      bug.rotation.y = Math.sin(elapsed * 5) * 0.4;
    },
  };
}

// ---------------------------------------------------------------------------
// Ship Dock — release events. A cargo container loads onto the stack.
// ---------------------------------------------------------------------------
const CARGO_COLORS = ["#e05252", "#ffb84d", "#4fe3c1", "#4a7fd0"];

function createDock(spec: BuildingSpec): BuildingInstance {
  const g = new Group();
  g.name = "dock";
  g.position.set(spec.x, 0, spec.z);

  const pad = box(5, 0.3, 4, PALETTE.panelMid);
  pad.position.y = 0.15;
  g.add(pad);

  // hazard stripes along the front edge
  for (let i = 0; i < 5; i++) {
    const stripe = box(0.5, 0.06, 0.4, i % 2 ? "#151b2b" : PALETTE.amber, {
      emissive: i % 2 ? "#000000" : PALETTE.amber,
      emissiveIntensity: i % 2 ? 0 : 0.25,
    });
    stripe.position.set(-2 + i, 0.33, 1.7);
    g.add(stripe);
  }

  // crane: post + jib + hook line
  const cranePost = cylinder(0.16, 0.2, 3.4, "#59617a");
  cranePost.position.set(-1.8, 1.85, -0.6);
  g.add(cranePost);
  const jib = box(3.4, 0.18, 0.18, "#59617a");
  jib.position.set(-0.3, 3.4, -0.6);
  g.add(jib);
  const hookLine = box(0.05, 1.0, 0.05, "#151b2b");
  hookLine.position.set(1.2, 2.85, -0.6);
  g.add(hookLine);
  const hook = box(0.3, 0.24, 0.3, "#8f9bb3");
  hook.position.set(1.2, 2.3, -0.6);
  g.add(hook);
  const cab = box(0.7, 0.6, 0.7, PALETTE.amber, { emissive: PALETTE.amber, emissiveIntensity: 0.2 });
  cab.position.set(-1.8, 3.7, -0.6);
  g.add(cab);

  // container stack: two base slots + two top slots
  const SLOTS: Array<[number, number, number]> = [
    [1.3, 0.55, -0.75],
    [1.3, 0.55, 0.75],
    [1.3, 1.05, -0.75],
    [1.3, 1.05, 0.75],
  ];
  const containers: Mesh[] = [];
  const fx = new Fx(() => g.parent);
  let cargoN = 0;

  function launchCargo(): void {
    const idx = containers.length % SLOTS.length;
    if (containers.length >= SLOTS.length) {
      const victim = containers.shift()!;
      fx.fade(victim, 0.5);
    }
    const [sx, sy, sz] = SLOTS[idx]!;
    const color = CARGO_COLORS[cargoN++ % CARGO_COLORS.length]!;
    const crate = box(1.0, 0.5, 0.7, color, {
      emissive: color,
      emissiveIntensity: 0.15,
      metalness: 0.2,
      roughness: 0.6,
    });
    const from = new Vector3(spec.x + 1.2, 3.0, spec.z - 0.6);
    const to = new Vector3(spec.x + sx, sy, spec.z + sz);
    fx.fly(crate, from, to, 1.6, 0.9, (m) => {
      m.position.set(sx, sy, sz);
      g.add(m);
      containers.push(m);
    });
  }

  return {
    key: "dock",
    group: g,
    footprint: footprintOf(spec),
    door: { x: spec.doorX, z: spec.doorZ },
    launchCargo,
    update(dt, elapsed) {
      jib.position.y = 3.4 + Math.sin(elapsed * 1.4) * 0.06;
      hookLine.scale.y = 1 + Math.sin(elapsed * 1.4) * 0.1;
      hook.position.y = 2.3 + Math.sin(elapsed * 1.4) * 0.12;
      hook.rotation.y = Math.sin(elapsed * 0.9) * 0.3;
      cab.rotation.y = Math.sin(elapsed * 0.5) * 0.12;
      fx.update(dt);
    },
  };
}

// ---------------------------------------------------------------------------
// Perimeter firewall — instanced barrier ring; also seals the nav grid.
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
    mat("#4a556b", { roughness: 0.8, metalness: 0.35 }),
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
    mat("#d99a3a", { roughness: 0.7 }),
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
    mat("#39435a", { roughness: 0.8, metalness: 0.35 }),
    towers.length,
  );
  towerBases.castShadow = true;
  const towerMasts = new InstancedMesh(
    new CylinderGeometry(0.08, 0.14, 1.8, 6),
    mat("#59617a", { roughness: 0.5, metalness: 0.5 }),
    towers.length,
  );
  towerMasts.castShadow = true;
  const towerBeacons = new InstancedMesh(
    new SphereGeometry(0.2, 8, 6),
    mat(PALETTE.alertRed, { emissive: PALETTE.alertRed, emissiveIntensity: 1.4 }),
    towers.length,
  );
  towers.forEach(([x, z], i) => {
    dummy.position.set(x, 1.35, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    towerBases.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 3.6, z);
    dummy.updateMatrix();
    towerMasts.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 4.6, z);
    dummy.updateMatrix();
    towerBeacons.setMatrixAt(i, dummy.matrix);
  });
  towerBases.instanceMatrix.needsUpdate = true;
  towerMasts.instanceMatrix.needsUpdate = true;
  towerBeacons.instanceMatrix.needsUpdate = true;
  root.add(towerBases, towerMasts, towerBeacons);

  return root;
}

export function createBuilding(spec: BuildingSpec): BuildingInstance {
  switch (spec.key) {
    case "command":
      return createCommand(spec);
    case "docs":
      return createDocs(spec);
    case "devfloor":
      return createDevFloor(spec);
    case "ops":
      return createOps(spec);
    case "qa":
      return createQA(spec);
    case "racks":
      return createRacks(spec);
    case "power":
      return createPower(spec);
    case "release":
      return createRelease(spec);
    case "noc":
      return createNOC(spec);
    case "incident":
      return createIncident(spec);
    case "gate":
      return createGate(spec);
    case "debug":
      return createDebug(spec);
    case "dock":
      return createDock(spec);
  }
}
