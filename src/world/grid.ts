/**
 * Uniform navigation grid + A* pathfinding.
 * Pure TypeScript (no three.js) so it stays unit-testable in node.
 *
 * World space: X/Z plane, 1 cell = 1 world unit, world = cell - half + 0.5.
 * 8-directional movement with corner-cut prevention + path smoothing.
 */

export interface Point {
  x: number;
  z: number;
}

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const DIAG = Math.SQRT2;
const WALKABLE = 1;
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, DIAG],
  [1, -1, DIAG],
  [-1, 1, DIAG],
  [-1, -1, DIAG],
];

/** Binary min-heap over (f, cellIdx). */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number | undefined {
    if (this.keys.length === 0) return undefined;
    const top = this.vals[0]!;
    const lastK = this.keys.pop()!;
    const lastV = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastK;
      this.vals[0] = lastV;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.vals[a], this.vals[b]] = [this.vals[b]!, this.vals[a]!];
  }
}

export class NavGrid {
  readonly size: number;
  readonly half: number;
  private blocked: Uint8Array;
  private g: Float64Array;
  private came: Int32Array;
  /** Stamp of the search that closed each cell (0 = never). */
  private closed: Int32Array;
  private stamp = 0;
  private stamps: Int32Array;

  constructor(size = 96) {
    this.size = size;
    this.half = size / 2;
    const n = size * size;
    this.blocked = new Uint8Array(n);
    this.g = new Float64Array(n);
    this.came = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.stamps = new Int32Array(n);
  }

  cellFromWorld(v: number): number {
    return Math.floor(v + this.half);
  }

  worldFromCell(c: number): number {
    return c - this.half + 0.5;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.size && cz < this.size;
  }

  isBlockedCell(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) return true;
    return this.blocked[cz * this.size + cx] === 1;
  }

  isBlockedWorld(x: number, z: number): boolean {
    return this.isBlockedCell(this.cellFromWorld(x), this.cellFromWorld(z));
  }

  setBlockedCell(cx: number, cz: number, v = 1): void {
    if (this.inBounds(cx, cz)) this.blocked[cz * this.size + cx] = v;
  }

  /** Block every cell overlapping a world-space rect (inclusive edges). */
  blockRect(r: Rect): void {
    const cx0 = this.cellFromWorld(r.x0);
    const cz0 = this.cellFromWorld(r.z0);
    const cx1 = this.cellFromWorld(r.x1 - 1e-6);
    const cz1 = this.cellFromWorld(r.z1 - 1e-6);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) this.setBlockedCell(cx, cz, 1);
    }
  }

  /** Nearest free cell to (cx,cz) within maxR (spiral out). */
  freeCellNear(cx: number, cz: number, maxR = 8): [number, number] | null {
    if (this.inBounds(cx, cz) && !this.isBlockedCell(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (this.inBounds(nx, nz) && !this.isBlockedCell(nx, nz)) return [nx, nz];
        }
      }
    }
    return null;
  }

  /** Sampled line-of-sight between two world points (no blocked cell crossed). */
  lineFree(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / 0.4));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedWorld(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }

  /**
   * A* from → to in world space. Returns smoothed world waypoints
   * (excluding the start point, including the goal) or null if unreachable.
   */
  findPath(from: Point, to: Point): Point[] | null {
    let [sx, sz] = [this.cellFromWorld(from.x), this.cellFromWorld(from.z)];
    let [gx, gz] = [this.cellFromWorld(to.x), this.cellFromWorld(to.z)];

    const start = this.freeCellNear(sx, sz);
    const goal = this.freeCellNear(gx, gz);
    if (!start || !goal) return null;
    [sx, sz] = start;
    [gx, gz] = goal;

    const startIdx = sz * this.size + sx;
    const goalIdx = gz * this.size + gx;
    if (startIdx === goalIdx) {
      return this.isBlockedWorld(to.x, to.z)
        ? [{ x: this.worldFromCell(gx), z: this.worldFromCell(gz) }]
        : [{ x: to.x, z: to.z }];
    }

    this.stamp++;
    const stamp = this.stamp;
    const open = new MinHeap();
    const h = (cx: number, cz: number): number => {
      const ax = Math.abs(cx - gx);
      const az = Math.abs(cz - gz);
      return Math.max(ax, az) + (DIAG - 1) * Math.min(ax, az);
    };

    this.g[startIdx] = 0;
    this.stamps[startIdx] = stamp;
    this.came[startIdx] = -1;
    open.push(h(sx, sz), startIdx);

    let found = false;
    while (open.size > 0) {
      const cur = open.pop()!;
      if (cur === goalIdx) {
        found = true;
        break;
      }
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;

      const cx = cur % this.size;
      const cz = (cur / this.size) | 0;
      const baseG = this.g[cur]!;

      for (const [dx, dz, cost] of DIRS) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (this.isBlockedCell(nx, nz)) continue;
        // Never cut corners through a blocked cell on diagonals.
        if (dx !== 0 && dz !== 0) {
          if (this.isBlockedCell(cx + dx, cz) || this.isBlockedCell(cx, cz + dz)) continue;
        }
        const nIdx = nz * this.size + nx;
        const ng = baseG + cost;
        if (this.stamps[nIdx] === stamp && ng >= (this.g[nIdx] ?? Infinity)) continue;
        this.g[nIdx] = ng;
        this.stamps[nIdx] = stamp;
        this.came[nIdx] = cur;
        open.push(ng + h(nx, nz), nIdx);
      }
    }

    if (!found) return null;

    // Reconstruct (goal → start), then reverse.
    const raw: Point[] = [];
    let cur = goalIdx;
    while (cur !== -1) {
      const cx = cur % this.size;
      const cz = (cur / this.size) | 0;
      raw.push({ x: this.worldFromCell(cx), z: this.worldFromCell(cz) });
      cur = this.came[cur]!;
    }
    raw.reverse();

    // String-pull: keep only waypoints we can't see past.
    const smooth: Point[] = [];
    let anchor = 0;
    smooth.push(raw[0]!);
    while (anchor < raw.length - 1) {
      let best = anchor + 1;
      for (let j = raw.length - 1; j > anchor; j--) {
        const a = raw[anchor]!;
        const b = raw[j]!;
        if (this.lineFree(a.x, a.z, b.x, b.z)) {
          best = j;
          break;
        }
      }
      smooth.push(raw[best]!);
      anchor = best;
    }

    // Land exactly on the requested goal when it's standable.
    if (!this.isBlockedWorld(to.x, to.z)) {
      smooth[smooth.length - 1] = { x: to.x, z: to.z };
    }
    // Drop the start cell — callers already stand there.
    return smooth.slice(1);
  }

  /** Random free world point within `radius` of (cx,cz). */
  randomFreePoint(cx: number, cz: number, radius: number): Point | null {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (!this.isBlockedWorld(x, z)) return { x, z };
    }
    return null;
  }
}
