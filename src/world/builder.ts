import {
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
} from "three";
import type { BuildingInstance } from "./buildings";
import type { NavGrid, Point } from "./grid";

export interface BuilderTask {
  building: BuildingInstance;
  workSeconds: number;
}

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

function makeNameTag(name: string, colorHex: number): Sprite | null {
  if (typeof document === "undefined") return null;
  const pad = 16;
  const font = "600 34px ui-rounded, system-ui, sans-serif";
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const textW = Math.ceil(probe.measureText(name).width);
  const canvas = document.createElement("canvas");
  canvas.width = textW + pad * 2;
  canvas.height = 54;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.font = font;
  ctx.textBaseline = "middle";
  const r = 18;
  ctx.fillStyle = "rgba(10, 14, 24, 0.78)";
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, r);
  ctx.fill();
  ctx.strokeStyle = `#${colorHex.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#f2f5ff";
  ctx.fillText(name, pad, canvas.height / 2 + 1);

  const sprite = new Sprite(
    new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  sprite.scale.set(canvas.width / 56, 0.4, 1);
  sprite.position.y = 2.15;
  return sprite;
}

const WALK_SPEED = 4.2;

export class Builder {
  readonly group = new Group();
  readonly agentId: string;
  readonly name: string;
  readonly color: number;
  state: "idle" | "walk" | "work" = "idle";

  private path: Point[] = [];
  private pathIdx = 0;
  private queue: BuilderTask[] = [];
  private current: BuilderTask | null = null;
  private workT = 0;
  private facing = Math.PI;
  private walkPhase = 0;
  private hammerPhase = 0;
  private idleT = 1 + Math.random() * 2;

  private legA: Mesh;
  private legB: Mesh;
  private armA: Group;
  private armB: Group;
  private body: Mesh;
  private hammerPivot: Group;
  private torsoPivot: Group;

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
    const antenna = part(0.06, 0.22, 0.06, 0x9aa3b2);
    antenna.position.set(0.16, 1.56, 0);

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

    this.group.add(this.legA, this.legB, this.torsoPivot, head, visor, antenna, armAPivot, this.hammerPivot);
    this.armA = armAPivot;
    this.armB = this.hammerPivot;

    const tag = makeNameTag(name, color);
    if (tag) this.group.add(tag);

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

  /** Advance path / task state. Returns nothing — read `state` after. */
  update(
    dt: number,
    elapsed: number,
    others: Builder[],
    grid: NavGrid,
  ): void {
    const pos = this.group.position;

    // --- task selection ----------------------------------------------------
    if (!this.current && this.queue.length > 0 && this.state !== "work") {
      this.current = this.queue.shift()!;
      this.pathTo(this.current.building.door);
    }

    // --- movement ----------------------------------------------------------
    if (this.state === "walk") {
      const arrived = this.stepPath(dt, WALK_SPEED);
      if (arrived) {
        if (this.current) {
          this.state = "work";
          this.workT = 0;
          this.faceBuilding(this.current.building);
        } else {
          this.state = "idle";
          this.idleT = 2 + Math.random() * 3;
        }
      }
    } else if (this.state === "idle") {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.idleT = 2.5 + Math.random() * 3;
        const p = grid.randomFreePoint(this.camp.x, this.camp.z, this.camp.radius);
        if (p) {
          this.path = [p];
          this.pathIdx = 0;
          this.state = "walk";
        }
      }
      // gentle breathing bob
      this.group.position.y = Math.sin(elapsed * 2 + this.facing) * 0.03;
    }

    // --- working: hammer swing --------------------------------------------
    if (this.state === "work" && this.current) {
      this.workT += dt;
      this.hammerPhase += dt * 7.5;
      const swing = Math.max(0, Math.sin(this.hammerPhase));
      this.armB.rotation.x = -0.5 - 1.75 * swing;
      this.armA.rotation.x = 0.35;
      this.torsoPivot.rotation.x = 0.12 + swing * 0.1;
      this.group.position.y = Math.sin(elapsed * 9) * 0.015;
      this.legA.rotation.x *= 0.82;
      this.legB.rotation.x *= 0.82;

      if (this.workT >= this.current.workSeconds) {
        this.current = null;
        this.armB.rotation.x = 0;
        this.torsoPivot.rotation.x = 0;
        if (this.queue.length > 0) {
          this.current = this.queue.shift()!;
          this.pathTo(this.current.building.door);
        } else {
          this.state = "idle";
          this.idleT = 1 + Math.random() * 2;
        }
      }
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

    this.animateWalk(dt);
  }

  private pathTo(target: Point): void {
    const start = { x: this.group.position.x, z: this.group.position.z };
    const found = this.grid.findPath(start, target);
    this.path = found && found.length > 0 ? found : [target];
    this.pathIdx = 0;
    this.state = "walk";
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

  private animateWalk(dt: number): void {
    if (this.state === "walk") {
      this.walkPhase += dt * 11;
      const s = Math.sin(this.walkPhase);
      this.legA.rotation.x = s * 0.75;
      this.legB.rotation.x = -s * 0.75;
      this.armA.rotation.x = -s * 0.5;
      this.armB.rotation.x = s * 0.3;
      this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.07;
    } else if (this.state === "idle") {
      this.legA.rotation.x *= 0.85;
      this.legB.rotation.x *= 0.85;
      this.armA.rotation.x *= 0.85;
    }
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
