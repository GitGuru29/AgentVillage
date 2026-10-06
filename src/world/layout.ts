/**
 * Village layout: where buildings sit, their footprints, doors,
 * dirt-path corridors and the idle camp. Pure data — no three.js,
 * so tests and the nav grid can share it.
 */

export type BuildingKey = "townHall" | "library" | "forge" | "barracks" | "archery";

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
];

/** Plaza knot every dirt path leads to. */
export const PLAZA = { x: 0, z: 7.5 } as const;

/** Where builders idle / wander when they have no task. */
export const IDLE_CAMP = { x: 0, z: 11, radius: 3.6 } as const;

/** Dirt corridors: each door walks a straight shot to the plaza. */
export function pathSegments(): Array<[[number, number], [number, number]]> {
  return BUILDINGS.map((b) => [
    [b.doorX, b.doorZ],
    [PLAZA.x, PLAZA.z],
  ]);
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
