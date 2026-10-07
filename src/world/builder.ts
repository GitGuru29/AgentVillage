import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
} from "three";
import type { BuildingInstance } from "./buildings";
import type { NavGrid, Point } from "./grid";

export interface BuilderTask {
  building: BuildingInstance;
  workSeconds: number;
}

/**
 * Agent lifecycle state (Phase 5). Public — HUD/tests read it, events drive it.
 *
 *   idle      no tasks; wanders the camp
 *   thinking  task enqueued; pathing/arriving at the building
 *   working   at the door, hammering
 *   approval  at the Security Gate awaiting a badge scan
 *   stuck     A* found no path; retries every RETRY seconds
 *   error     handling a failure at the Incident Room
 *   done      task finished; brief celebration before idle/next task
 *   crashed   error storm (two `error` events within ERROR_WINDOW);
 *             queue dropped, robot slumps; next event revives it
 */
export type AgentState =
  | "idle"
  | "thinking"
  | "working"
  | "approval"
  | "stuck"
  | "error"
  | "done"
  | "crashed";

export const STATE_LIGHT: Record<AgentState, number> = {
  idle: 0x7ef0ff,
  thinking: 0x9d8cff,
  working: 0x4fe3c1,
  approval: 0xffb84d,
  stuck: 0xff8a3d,
  error: 0xe05252,
  done: 0x4fd67a,
  crashed: 0x1c2233,
};

const STATE_CSS: Record<AgentState, string> = {
  idle: "#7ef0ff",
  thinking: "#9d8cff",
  working: "#4fe3c1",
  approval: "#ffb84d",
  stuck: "#ff8a3d",
  error: "#e05252",
  done: "#4fd67a",
  crashed: "#6b7386",
};

/** Stable saturated cartoon hue per agent id. */
export function agentColor(agentId: string): number {
  let h = 2166136261;
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360) / 360;
  return new Color().setHSL(hue, 0.68, 0.55).getHex();
}

function part(w: number, h: number, d: number, color: number, emissive?: number): Mesh {
  const m = new Mesh(
    new BoxGeometry(w, h, d),
    new MeshStandardMaterial({
      color,
      roughness: 0.75,
      metalness: 0.1,
      ...(emissive !== undefined
        ? { emissive, emissiveIntensity: 0.85 }
        : {}),
    }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const WALK_SPEED = 4.2;
const RETRY_SECONDS = 2.2;

export class Builder {
  readonly group = new Group();
  readonly agentId: string;
  readonly name: string;
  readonly color: number;
  state: AgentState = "idle";

  private path: Point[] = [];
  private pathIdx = 0;
  private queue: BuilderTask[] = [];
  private current: BuilderTask | null = null;
  private workT = 0;
  private facing = Math.PI;
  private walkPhase = 0;
  private hammerPhase = 0;
  private idleT = 1 + Math.random() * 2;
  private traveling = false;
  private stateT = 0;
  private stuckFacing = 0;

  private legA: Mesh;
  private legB: Mesh;
  private armA: Group;
  private armB: Group;
  private body: Mesh;
  private hammerPivot: Group;
  private torsoPivot: Group;
  private visorMat: MeshStandardMaterial;
  private stateLightMat: MeshStandardMaterial;

  private tagCanvas: HTMLCanvasElement | null = null;
  private tagCtx: CanvasRenderingContext2D | null = null;
  private tagTexture: CanvasTexture | null = null;
  private tagSprite: Sprite | null = null;

  constructor(
    agentId: string,
    name: string,
    color: number,
    private camp: { x: number; z: number; radius: number },
    private grid: NavGrid,
  ) {
    this.agentId = agentId;
    this.name = name;
    this.color = color;
    this.group.name = `builder:${agentId}`;
    this.group.userData.agentId = agentId;

    this.legA = part(0.2, 0.36, 0.22, 0x3b3f4a);
    this.legB = part(0.2, 0.36, 0.22, 0x3b3f4a);
    this.legA.position.set(-0.16, 0.18, 0);
    this.legB.position.set(0.16, 0.18, 0);

    this.body = part(0.66, 0.62, 0.46, color);
    this.body.position.y = 0.68;

    const head = part(0.52, 0.44, 0.5, 0xdfe3ec);
    head.position.y = 1.24;
    const visor = part(0.34, 0.14, 0.08, 0x232a38, color);
    visor.position.set(0, 1.26, 0.26);
    this.visorMat = visor.material as MeshStandardMaterial;
    const antenna = part(0.06, 0.22, 0.06, 0x9aa3b2);
    antenna.position.set(0.16, 1.56, 0);

    // state beacon above the antenna
    const stateLight = new Mesh(
      new SphereGeometry(0.1, 10, 8),
      new MeshStandardMaterial({
        color: STATE_LIGHT.idle,
        emissive: STATE_LIGHT.idle,
        emissiveIntensity: 0.7,
        roughness: 0.4,
      }),
    );
    stateLight.name = "stateLight";
    stateLight.position.set(0.16, 1.78, 0);
    this.stateLightMat = stateLight.material as MeshStandardMaterial;

    const armAMesh = part(0.18, 0.52, 0.2, color);
    armAMesh.position.y = -0.26;
    const armAPivot = new Group();
    armAPivot.position.set(-0.44, 1.0, 0);
    armAPivot.add(armAMesh);

    const armBMesh = part(0.18, 0.52, 0.2, color);
    armBMesh.position.y = -0.26;
    this.hammerPivot = new Group();
    this.hammerPivot.position.set(0.44, 1.0, 0);
    this.hammerPivot.add(armBMesh);

    const handle = part(0.08, 0.7, 0.08, 0x8a6a42);
    handle.position.y = -0.72;
    const hammerHead = part(0.4, 0.2, 0.2, 0x9aa3b2, undefined);
    hammerHead.position.y = -1.04;
    (hammerHead.material as MeshStandardMaterial).metalness = 0.6;
    (hammerHead.material as MeshStandardMaterial).roughness = 0.4;
    this.hammerPivot.add(handle, hammerHead);

    this.torsoPivot = new Group();
    this.torsoPivot.position.y = 0.36;
    this.torsoPivot.add(this.body);

    this.group.add(
      this.legA,
      this.legB,
      this.torsoPivot,
      head,
      visor,
      antenna,
      stateLight,
      armAPivot,
      this.hammerPivot,
    );
    this.armA = armAPivot;
    this.armB = this.hammerPivot;

    this.buildTag();

    this.group.position.set(
      camp.x + (Math.random() - 0.5) * camp.radius,
      0,
      camp.z + (Math.random() - 0.5) * camp.radius,
    );
    this.facing = Math.random() * Math.PI * 2;
    this.group.rotation.y = this.facing;
  }

  /** True while the builder has a queued/current task (idle wandering doesn't count). */
  get active(): boolean {
    return this.hasTasks();
  }

  enqueue(task: BuilderTask): void {
    this.queue.push(task);
  }

  hasTasks(): boolean {
    return this.queue.length > 0 || this.current !== null;
  }

  /** Error storm: drop everything and slump until the next event revives us. */
  crash(): void {
    this.setState("crashed");
  }

  /** Switch lifecycle state: updates the beacon + name tag, resets transient pose. */
  private setState(next: AgentState): void {
    if (next === this.state) return;
    const wasCrashed = this.state === "crashed";
    this.state = next;

    // pose reset — every stationary state sets its own pose each frame
    this.armA.rotation.set(0, 0, 0);
    this.armB.rotation.set(0, 0, 0);
    this.torsoPivot.rotation.set(0, 0, 0);
    this.group.position.y = 0;

    if (next === "crashed") {
      this.queue.length = 0;
      this.current = null;
      this.traveling = false;
      this.path = [];
      this.pathIdx = 0;
      this.torsoPivot.rotation.x = 0.85; // face-plant slump
      this.armA.rotation.x = 0.6;
      this.armB.rotation.x = 0.6;
      this.legA.rotation.x = -0.5;
      this.legB.rotation.x = 0.5;
      this.visorMat.emissiveIntensity = 0;
      this.stateT = 0;
    } else if (wasCrashed) {
      this.visorMat.emissiveIntensity = 0.85;
      this.legA.rotation.x = 0;
      this.legB.rotation.x = 0;
    }

    const hex = STATE_LIGHT[next];
    this.stateLightMat.color.set(hex);
    this.stateLightMat.emissive.set(hex);
    this.redrawTag();
  }

  /** Lifecycle flavor once the builder reaches its assigned building. */
  private workState(): AgentState {
    const key = this.current?.building.key;
    if (key === "gate") return "approval";
    if (key === "incident") return "error";
    return "working";
  }

  /** Advance path / task state. Returns nothing — read `state` after. */
  update(
    dt: number,
    elapsed: number,
    others: Builder[],
    grid: NavGrid,
  ): void {
    const pos = this.group.position;

    // --- task selection ----------------------------------------------------
    if (
      !this.current &&
      this.queue.length > 0 &&
      (this.state === "idle" || this.state === "stuck" || this.state === "crashed")
    ) {
      this.current = this.queue.shift()!;
      this.startTrip(this.current.building.door);
    }

    // --- travel (task trip or camp wander) ---------------------------------
    if (this.traveling) {
      const arrived = this.stepPath(dt, WALK_SPEED);
      if (arrived) {
        this.traveling = false;
        if (this.current) {
          this.setState(this.workState());
          this.workT = 0;
          this.faceBuilding(this.current.building);
        } else {
          this.idleT = 2 + Math.random() * 3;
        }
      }
    }

    // --- idle: wander the camp --------------------------------------------
    if (this.state === "idle" && !this.traveling) {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.idleT = 2.5 + Math.random() * 3;
        const p = grid.randomFreePoint(this.camp.x, this.camp.z, this.camp.radius);
        if (p) this.startTrip(p);
      }
      // gentle breathing bob
      this.group.position.y = Math.sin(elapsed * 2 + this.facing) * 0.03;
    }

    // --- stuck: wait, wobble, retry the path -------------------------------
    if (this.state === "stuck" && this.current) {
      this.facing = this.stuckFacing + Math.sin(elapsed * 2.2) * 0.7;
      this.stateT -= dt;
      if (this.stateT <= 0) {
        this.stateT = RETRY_SECONDS;
        this.startTrip(this.current.building.door);
      }
      this.armA.rotation.z = 0.9;
      this.armB.rotation.z = -0.9;
      this.armA.rotation.x = -0.4;
      this.armB.rotation.x = -0.4;
      this.torsoPivot.rotation.x = -0.08;
    }

    // --- at the door: working / approval / error ---------------------------
    if (this.current && this.state !== "crashed" && this.state !== "done") {
      const atDoor =
        this.state === "working" || this.state === "approval" || this.state === "error";
      if (atDoor) {
        this.workT += dt;
        if (this.state === "working") {
          // hammer swing
          this.hammerPhase += dt * 7.5;
          const swing = Math.max(0, Math.sin(this.hammerPhase));
          this.armB.rotation.x = -0.5 - 1.75 * swing;
          this.armA.rotation.x = 0.35;
          this.torsoPivot.rotation.x = 0.12 + swing * 0.1;
          this.group.position.y = Math.sin(elapsed * 9) * 0.015;
        } else if (this.state === "approval") {
          // badge-scan wave: both arms up, waving
          this.armA.rotation.x = -1.4 + Math.sin(elapsed * 3) * 0.25;
          this.armB.rotation.x = -1.4 + Math.cos(elapsed * 3.4) * 0.25;
          this.group.position.y = Math.abs(Math.sin(elapsed * 4)) * 0.04;
        } else {
          // error: violent shudder
          this.torsoPivot.rotation.z = Math.sin(elapsed * 30) * 0.07;
          this.torsoPivot.rotation.x = 0.1;
          this.armA.rotation.x = 0.55;
          this.armB.rotation.x = 0.55;
          pos.x += Math.sin(elapsed * 41) * 0.004;
          pos.z += Math.cos(elapsed * 37) * 0.004;
        }

        if (this.workT >= this.current.workSeconds) {
          this.current = null;
          this.setState("done");
          this.stateT = 1.3;
        }
      }
    }

    // --- done: brief celebration ------------------------------------------
    if (this.state === "done") {
      this.armA.rotation.x = -2.5 + Math.sin(elapsed * 12) * 0.3;
      this.armB.rotation.x = -2.5 + Math.cos(elapsed * 12) * 0.3;
      this.torsoPivot.rotation.x = -0.06;
      this.group.position.y = Math.abs(Math.sin(elapsed * 10)) * 0.12;
      this.stateT -= dt;
      if (this.stateT <= 0) {
        if (this.queue.length > 0) {
          this.current = this.queue.shift()!;
          this.startTrip(this.current.building.door);
        } else {
          this.setState("idle");
          this.idleT = 1 + Math.random() * 2;
        }
      }
    }

    // --- state beacon pulse -------------------------------------------------
    const L = this.stateLightMat;
    switch (this.state) {
      case "idle":
        L.emissiveIntensity = 0.55 + 0.15 * Math.sin(elapsed * 2);
        break;
      case "thinking":
        L.emissiveIntensity = 0.8 + 0.5 * Math.sin(elapsed * 7);
        break;
      case "working":
        L.emissiveIntensity = 0.8 + 0.2 * Math.sin(elapsed * 5);
        break;
      case "approval":
        L.emissiveIntensity = 0.85 + 0.45 * Math.sin(elapsed * 3);
        break;
      case "stuck":
        L.emissiveIntensity = Math.sin(elapsed * 4) > 0 ? 1.5 : 0.15;
        break;
      case "error":
        L.emissiveIntensity = Math.sin(elapsed * 13) > 0 ? 1.7 : 0.2;
        break;
      case "done":
        L.emissiveIntensity = 1.9;
        break;
      case "crashed":
        L.emissiveIntensity = 0.05;
        break;
    }

    // --- separation: builders never clip through each other ----------------
    for (const other of others) {
      if (other === this) continue;
      const dx = pos.x - other.group.position.x;
      const dz = pos.z - other.group.position.z;
      const dist = Math.hypot(dx, dz);
      const MIN = 0.85;
      if (dist > 1e-4 && dist < MIN) {
        const push = ((MIN - dist) / MIN) * 3.4 * dt;
        pos.x += (dx / dist) * push;
        pos.z += (dz / dist) * push;
      }
    }

    // --- facing smoothing --------------------------------------------------
    let diff = this.facing - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * Math.min(1, dt * 12);

    // --- limb animation ----------------------------------------------------
    if (this.traveling) {
      this.walkPhase += dt * 11;
      const s = Math.sin(this.walkPhase);
      this.legA.rotation.x = s * 0.75;
      this.legB.rotation.x = -s * 0.75;
      this.armA.rotation.x = -s * 0.5;
      this.armB.rotation.x = s * 0.3;
      this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.07;
    } else if (this.state !== "crashed") {
      // settle legs; idle also settles arms (other states pose them per frame)
      this.legA.rotation.x *= 0.85;
      this.legB.rotation.x *= 0.85;
      if (this.state === "idle") {
        this.armA.rotation.x *= 0.85;
        this.armB.rotation.x *= 0.85;
      }
    }
  }

  /**
   * Start following a path to `target`.
   * Unreachable → `stuck` (task kept for retries); camp wander failure → idle.
   */
  private startTrip(target: Point): void {
    const start = { x: this.group.position.x, z: this.group.position.z };
    const found = this.grid.findPath(start, target);
    if (!found || found.length === 0) {
      if (this.current) {
        this.stuckFacing = this.facing;
        this.setState("stuck");
        this.stateT = RETRY_SECONDS;
      } else {
        this.setState("idle");
        this.idleT = 1 + Math.random() * 2;
      }
      this.traveling = false;
      this.path = [];
      this.pathIdx = 0;
      return;
    }
    this.path = found;
    this.pathIdx = 0;
    this.traveling = true;
    // camp wander (no task) keeps the idle state — only real trips think
    if (this.current) this.setState("thinking");
  }

  private stepPath(dt: number, speed: number): boolean {
    if (this.pathIdx >= this.path.length) return true;
    const target = this.path[this.pathIdx]!;
    const pos = this.group.position;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.14) {
      this.pathIdx++;
      return this.pathIdx >= this.path.length;
    }
    const step = Math.min(dist, speed * dt);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    this.facing = Math.atan2(dx, dz);
    return false;
  }

  private faceBuilding(b: BuildingInstance): void {
    const dx = b.door.x - this.group.position.x;
    const dz = b.door.z - this.group.position.z;
    this.facing = Math.atan2(dx, dz);
    this.group.rotation.y = this.facing;
  }

  // --- name tag: name line + live state line --------------------------------
  private buildTag(): void {
    if (typeof document === "undefined") return;
    const nameFont = "600 30px ui-rounded, system-ui, sans-serif";
    const stateFont = "600 26px ui-rounded, system-ui, sans-serif";
    const probe = document.createElement("canvas").getContext("2d");
    if (!probe) return;
    probe.font = nameFont;
    const nameW = Math.ceil(probe.measureText(this.name).width);
    probe.font = stateFont;
    let stateW = 0;
    for (const s of Object.keys(STATE_CSS) as AgentState[]) {
      stateW = Math.max(stateW, Math.ceil(probe.measureText(s).width));
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(nameW, stateW) + 40;
    canvas.height = 84;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    this.tagCanvas = canvas;
    this.tagCtx = ctx;
    this.tagTexture = new CanvasTexture(canvas);

    const sprite = new Sprite(
      new SpriteMaterial({ map: this.tagTexture, transparent: true, depthWrite: false }),
    );
    sprite.scale.set(canvas.width / 56, canvas.height / 135, 1);
    sprite.position.y = 2.55;
    this.tagSprite = sprite;
    this.group.add(sprite);
    this.redrawTag();
  }

  private redrawTag(): void {
    const ctx = this.tagCtx;
    const canvas = this.tagCanvas;
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10, 14, 24, 0.78)";
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 18);
    ctx.fill();
    ctx.strokeStyle = `#${this.color.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 30px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = "#f2f5ff";
    ctx.fillText(this.name, w / 2, 26);
    ctx.font = "600 26px ui-rounded, system-ui, sans-serif";
    ctx.fillStyle = STATE_CSS[this.state];
    ctx.fillText(this.state, w / 2, 60);
    if (this.tagTexture) this.tagTexture.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      } else if ((o as Sprite).isSprite) {
        const m = (o as Sprite).material as SpriteMaterial;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
