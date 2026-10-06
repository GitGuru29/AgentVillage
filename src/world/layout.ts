/**
 * Village layout: where buildings sit, their footprints, doors,
 * walkway corridors and the idle camp. Pure data — no three.js,
 * so tests and the nav grid can share it.
 */

export type BuildingKey =
  | "command"
  | "docs"
  | "devfloor"
  | "ops"
  | "qa"
  | "racks"
  | "power"
  | "release"
  | "noc"
  | "incident"
  | "gate"
  | "debug"
  | "dock";

export interface BuildingSpec {
  key: BuildingKey;
  /** Center of the footprint in world units. */
  x: number;
  z: number;
  w: number;
  d: number;
  /** Stand-off point where builders work (outside the footprint). */
  doorX: number;
  doorZ: number;
}

export const BUILDINGS: readonly BuildingSpec[] = [
  { key: "command", x: 0, z: 0, w: 8, d: 8, doorX: 0, doorZ: 5.4 },
  { key: "docs", x: -17, z: -6, w: 6, d: 5, doorX: -17, doorZ: -2.3 },
  { key: "devfloor", x: 17, z: -6, w: 6, d: 5, doorX: 17, doorZ: -2.3 },
  { key: "ops", x: -13, z: 13, w: 6, d: 5, doorX: -13, doorZ: 16.3 },
  { key: "qa", x: 13, z: 13, w: 7, d: 5, doorX: 13, doorZ: 16.3 },
  { key: "racks", x: -9.5, z: -15.5, w: 7, d: 6, doorX: -9.5, doorZ: -11.9 },
  { key: "power", x: 9.5, z: -15.5, w: 7, d: 6, doorX: 9.5, doorZ: -11.9 },
  { key: "release", x: 0, z: -15.5, w: 6, d: 5, doorX: 0, doorZ: -11.9 },
  { key: "incident", x: -20.5, z: 2, w: 5, d: 5, doorX: -16.9, doorZ: 2 },
  { key: "noc", x: 20.5, z: 2, w: 5, d: 6, doorX: 16.9, doorZ: 2 },
  { key: "gate", x: -19.5, z: 12.5, w: 5, d: 5, doorX: -19.5, doorZ: 16.5 },
  { key: "debug", x: 18.5, z: -13, w: 5, d: 5, doorX: 18.5, doorZ: -9.5 },
  { key: "dock", x: 20, z: 12, w: 5, d: 4, doorX: 20, doorZ: 15.5 },
];

/** Plaza knot every walkway leads to. */
export const PLAZA = { x: 0, z: 7.5 } as const;

/** Where builders idle / wander when they have no task. */
export const IDLE_CAMP = { x: 0, z: 11, radius: 3.6 } as const;

/**
 * Walkway corridors. Doors normally walk a straight shot to the plaza, but
 * the north row (racks, power, release) sits behind the Command Center —
 * those take an elbow through the east/west corridors instead. The three
 * outer buildings (gate, debug, dock) elbow around their neighbours.
 */
const ROUTES: Partial<Record<BuildingKey, Array<[number, number]>>> = {
  racks: [
    [-9.5, -11.9],
    [-9.5, 5.5],
    [0, 7.5],
  ],
  power: [
    [9.5, -11.9],
    [9.5, 5.5],
    [0, 7.5],
  ],
  release: [
    [0, -11.9],
    [5, -11.9],
    [5, 5.5],
    [0, 7.5],
  ],
  gate: [
    [-19.5, 16.5],
    [-5, 17.5],
    [0, 7.5],
  ],
  debug: [
    [18.5, -9.5],
    [11, -9.5],
    [11, 5.5],
    [0, 7.5],
  ],
  dock: [
    [20, 15.5],
    [17, 15.5],
    [17, 7.5],
    [0, 7.5],
  ],
};

export function pathSegments(): Array<[[number, number], [number, number]]> {
  const segs: Array<[[number, number], [number, number]]> = [];
  for (const b of BUILDINGS) {
    const route: Array<[number, number]> = ROUTES[b.key] ?? [
      [b.doorX, b.doorZ],
      [PLAZA.x, PLAZA.z],
    ];
    for (let i = 0; i < route.length - 1; i++) segs.push([route[i]!, route[i + 1]!]);
  }
  return segs;
}

/**
 * Perimeter firewall — a chamfered rectangle (octagon):
 * |x| ≤ 24, |z| ≤ 20, corners cut where |x| + |z| > 38.
 */
export const WALL_HALF_W = 24;
export const WALL_HALF_D = 20;
export const WALL_CHAMFER_X = 18;
export const WALL_CHAMFER_Z = 14;
export const WALL_CHAMFER = 6;

export const WALLS: ReadonlyArray<{ ax: number; az: number; bx: number; bz: number }> = [
  { ax: -18, az: -20, bx: 18, bz: -20 },
  { ax: 18, az: -20, bx: 24, bz: -14 },
  { ax: 24, az: -14, bx: 24, bz: 14 },
  { ax: 24, az: 14, bx: 18, bz: 20 },
  { ax: 18, az: 20, bx: -18, bz: 20 },
  { ax: -18, az: 20, bx: -24, bz: 14 },
  { ax: -24, az: 14, bx: -24, bz: -14 },
  { ax: -24, az: -14, bx: -18, bz: -20 },
];

/** True when (x,z) lies inside the firewall ring (grown by `margin`). */
export function insideWall(x: number, z: number, margin = 0): boolean {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax > WALL_HALF_W + margin || az > WALL_HALF_D + margin) return false;
  if (ax > WALL_CHAMFER_X && az > WALL_CHAMFER_Z) {
    return ax + az <= WALL_CHAMFER_X + WALL_CHAMFER_Z + WALL_CHAMFER + margin * 1.5;
  }
  return true;
}

export const PALETTE = {
  // data-center floor
  floorA: "#1a2029",
  floorB: "#1e2634",
  floorC: "#222b3c",
  walkway: "#38455c",
  // structure
  metal: "#8f9bb3",
  panelDark: "#2a3242",
  panelMid: "#39435a",
  shell: "#dfe6f2",
  // accents
  amber: "#ffb84d",
  teal: "#4fe3c1",
  screen: "#7ef0ff",
  alertRed: "#e05252",
  passGreen: "#4fd67a",
  failRed: "#d0342c",
  forgeFire: "#ff7a2f",
  wood: "#c9954e",
  darkWood: "#7a5230",
} as const;
