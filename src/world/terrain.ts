import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from "three";
import type { NavGrid } from "./grid";
import { BUILDINGS, insideWall, PALETTE, pathSegments, PLAZA } from "./layout";

const TILE_EXTENT = 32; // tiles span ±TILE_EXTENT
const TILE_SIZE = TILE_EXTENT * 2;

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function isWalkwayTile(x: number, z: number, segments: ReturnType<typeof pathSegments>): boolean {
  for (const [[ax, az], [bx, bz]] of segments) {
    if (distToSegment(x, z, ax, az, bx, bz) < 1.15) return true;
  }
  // plaza pad
  return Math.hypot(x - PLAZA.x, z - PLAZA.z) < 3.2;
}

/** Instanced dark data-center floor with lit walkways + edge decor. */
export function createTerrain(grid: NavGrid): Group {
  const root = new Group();
  root.name = "terrain";
  const segments = pathSegments();

  const tileGeo = new BoxGeometry(0.96, 0.3, 0.96);
  const tileMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0.15 });
  const tiles = new InstancedMesh(tileGeo, tileMat, TILE_SIZE * TILE_SIZE);
  tiles.receiveShadow = true;
  tiles.castShadow = false;

  const dummy = new Object3D();
  const floors = [PALETTE.floorA, PALETTE.floorB, PALETTE.floorC].map((c) => new Color(c));
  const walkway = new Color(PALETTE.walkway);
  const color = new Color();
  let i = 0;

  for (let gz = 0; gz < TILE_SIZE; gz++) {
    for (let gx = 0; gx < TILE_SIZE; gx++) {
      const x = gx - TILE_EXTENT;
      const z = gz - TILE_EXTENT;
      const walk = isWalkwayTile(x, z, segments);

      dummy.position.set(x, walk ? -0.17 : -0.15 + (Math.sin(gx * 12.9898 + gz * 78.233) % 1) * 0.03, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);

      if (walk) {
        color.copy(walkway).offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
      } else {
        color.copy(floors[i % floors.length]!).offsetHSL(0, 0, (Math.random() - 0.5) * 0.03);
      }
      tiles.setColorAt(i, color);
      i++;
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
  root.add(tiles);

  // --- decor: antenna masts + cable crates outside the firewall ring -------
  const spots: Array<[number, number]> = [];
  for (let n = 0; n < 44; n++) {
    const a = (n / 44) * Math.PI * 2 + Math.random() * 0.25;
    const r = 26 + Math.random() * 4;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.85;
    if (
      Math.abs(x) < TILE_EXTENT - 1 &&
      Math.abs(z) < TILE_EXTENT - 1 &&
      !insideWall(x, z, 1.6)
    )
      spots.push([x, z]);
  }

  const poles = new InstancedMesh(
    new CylinderGeometry(0.1, 0.16, 3.4, 6),
    new MeshStandardMaterial({ color: 0x59617a, roughness: 0.7, metalness: 0.4 }),
    spots.length,
  );
  const beacons = new InstancedMesh(
    new SphereGeometry(0.22, 8, 6),
    new MeshStandardMaterial({
      color: 0xe05252,
      emissive: 0xe05252,
      emissiveIntensity: 1.4,
      roughness: 0.5,
    }),
    spots.length,
  );
  poles.castShadow = true;
  spots.forEach(([x, z], idx) => {
    dummy.position.set(x, 1.7, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poles.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(x, 3.5, z);
    dummy.updateMatrix();
    beacons.setMatrixAt(idx, dummy.matrix);
  });
  root.add(poles, beacons);

  // cable crates / pallets
  const crates = new InstancedMesh(
    new BoxGeometry(1, 0.8, 1),
    new MeshStandardMaterial({ color: 0x39435a, roughness: 0.8, metalness: 0.25 }),
    16,
  );
  crates.castShadow = true;
  let cratePlaced = 0;
  for (let n = 0; n < 16 && cratePlaced < 16; n++) {
    const a = Math.random() * Math.PI * 2;
    const r = 25 + Math.random() * 5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.9;
    if (insideWall(x, z, 1.2)) continue;
    dummy.position.set(x, 0.24, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.set(0.6 + Math.random() * 0.7, 0.5 + Math.random() * 0.6, 0.6 + Math.random() * 0.7);
    dummy.updateMatrix();
    crates.setMatrixAt(cratePlaced, dummy.matrix);
    cratePlaced++;
  }
  crates.count = cratePlaced;
  crates.instanceMatrix.needsUpdate = true;
  root.add(crates);

  // building footprints are unwalkable
  for (const b of BUILDINGS) {
    grid.blockRect({
      x0: b.x - b.w / 2 - 0.3,
      z0: b.z - b.d / 2 - 0.3,
      x1: b.x + b.w / 2 + 0.3,
      z1: b.z + b.d / 2 + 0.3,
    });
  }

  return root;
}
