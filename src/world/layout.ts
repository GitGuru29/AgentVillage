/**
 * Village layout: where buildings sit, their footprints, doors,
 * dirt-path corridors and the idle camp. Pure data — no three.js,
 * so tests and the nav grid can share it.
 */

export type BuildingKey =
  | "townHall"
  | "library"
  | "forge"
  | "barracks"
  | "archery"
  | "goldMine"
  | "elixir"
  | "trophyHall"
  | "clockTower"
  | "mystery";

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
  { key: "townHall", x: 0, z: 0, w: 8, d: 8, doorX: 0, doorZ: 5.4 },
  { key: "library", x: -17, z: -6, w: 6, d: 5, doorX: -17, doorZ: -2.3 },
  { key: "forge", x: 17, z: -6, w: 6, d: 5, doorX: 17, doorZ: -2.3 },
  { key: "barracks", x: -13, z: 13, w: 6, d: 5, doorX: -13, doorZ: 16.3 },
  { key: "archery", x: 13, z: 13, w: 7, d: 5, doorX: 13, doorZ: 16.3 },
  { key: "goldMine", x: -9.5, z: -15.5, w: 7, d: 6, doorX: -9.5, doorZ: -11.9 },
  { key: "elixir", x: 9.5, z: -15.5, w: 7, d: 6, doorX: 9.5, doorZ: -11.9 },
  { key: "trophyHall", x: 0, z: -15.5, w: 6, d: 5, doorX: 0, doorZ: -11.9 },
  { key: "mystery", x: -20.5, z: 2, w: 5, d: 5, doorX: -16.9, doorZ: 2 },
  { key: "clockTower", x: 20.5, z: 2, w: 5, d: 6, doorX: 16.9, doorZ: 2 },
];

/** Plaza knot every dirt path leads to. */
export const PLAZA = { x: 0, z: 7.5 } as const;

/** Where builders idle / wander when they have no task. */
export const IDLE_CAMP = { x: 0, z: 11, radius: 3.6 } as const;

/**
 * Dirt corridors. Doors normally walk a straight shot to the plaza, but the
 * north row (gold mine, elixir, trophies) sits behind the Town Hall — those
 * take an elbow through the east/west corridors instead.
 */
const ROUTES: Partial<Record<BuildingKey, Array<[number, number]>>> = {
  goldMine: [
    [-9.5, -11.9],
    [-9.5, 5.5],
    [0, 7.5],
  ],
  elixir: [
    [9.5, -11.9],
    [9.5, 5.5],
    [0, 7.5],
  ],
  trophyHall: [
    [0, -11.9],
    [5, -11.9],
    [5, 5.5],
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
 * Perimeter wall ring — a chamfered rectangle (octagon):
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

/** True when (x,z) lies inside the wall ring (grown by `margin`). */
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
  grassA: "#6cb84a",
  grassB: "#5faa42",
  grassC: "#77c455",
  dirt: "#b9885a",
  stone: "#9aa6b8",
  cream: "#f0e0c2",
  roofRed: "#e05252",
  roofBlue: "#4a7fd0",
  roofRust: "#a8412c",
  wood: "#c9954e",
  darkWood: "#7a5230",
  gold: "#ffd23f",
  elixir: "#c86dd7",
  glowCode: "#7ef0ff",
  forgeFire: "#ff7a2f",
  flagGreen: "#4fd67a",
  failRed: "#d0342c",
  visorOn: "#8ef0c0",
} as const;
