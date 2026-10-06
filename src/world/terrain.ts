import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from "three";
import type { NavGrid } from "./grid";
import { BUILDINGS, PALETTE, pathSegments, PLAZA } from "./layout";

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

function isPathTile(x: number, z: number, segments: ReturnType<typeof pathSegments>): boolean {
  for (const [[ax, az], [bx, bz]] of segments) {
    if (distToSegment(x, z, ax, az, bx, bz) < 1.15) return true;
  }
  // plaza pad
  return Math.hypot(x - PLAZA.x, z - PLAZA.z) < 3.2;
}

/** Instanced grass tiles with dirt paths + scattered edge decor. */
export function createTerrain(grid: NavGrid): Group {
  const root = new Group();
  root.name = "terrain";
  const segments = pathSegments();

  const tileGeo = new BoxGeometry(0.96, 0.3, 0.96);
  const tileMat = new MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const tiles = new InstancedMesh(tileGeo, tileMat, TILE_SIZE * TILE_SIZE);
  tiles.receiveShadow = true;
  tiles.castShadow = false;

  const dummy = new Object3D();
  const grass = [PALETTE.grassA, PALETTE.grassB, PALETTE.grassC].map((c) => new Color(c));
  const dirt = new Color(PALETTE.dirt);
  const color = new Color();
  let i = 0;

  for (let gz = 0; gz < TILE_SIZE; gz++) {
    for (let gx = 0; gx < TILE_SIZE; gx++) {
      const x = gx - TILE_EXTENT;
      const z = gz - TILE_EXTENT;
      const path = isPathTile(x, z, segments);

      dummy.position.set(x, path ? -0.17 : -0.15 + (Math.sin(gx * 12.9898 + gz * 78.233) % 1) * 0.03, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);

      if (path) {
        color.copy(dirt).offsetHSL(0, 0, (Math.random() - 0.5) * 0.05);
      } else {
        color.copy(grass[i % grass.length]!).offsetHSL(0, 0, (Math.random() - 0.5) * 0.04);
      }
      tiles.setColorAt(i, color);
      i++;
    }
  }
  tiles.instanceMatrix.needsUpdate = true;
  if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
  root.add(tiles);

  // --- decor: instanced trees + rocks around the village rim -------------
  const spots: Array<[number, number]> = [];
  for (let n = 0; n < 34; n++) {
    const a = (n / 34) * Math.PI * 2 + Math.random() * 0.25;
    const r = 25 + Math.random() * 6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.85;
    if (Math.abs(x) < TILE_EXTENT - 1 && Math.abs(z) < TILE_EXTENT - 1) spots.push([x, z]);
  }

  const trunks = new InstancedMesh(
    new CylinderGeometry(0.22, 0.3, 1.2, 6),
    new MeshStandardMaterial({ color: 0x7a5230, roughness: 1 }),
    spots.length,
  );
  const crowns = new InstancedMesh(
    new ConeGeometry(1.15, 2.4, 7),
    new MeshStandardMaterial({ color: 0x3f9b4a, roughness: 1 }),
    spots.length,
  );
  trunks.castShadow = crowns.castShadow = true;
  const treeColor = new Color();
  spots.forEach(([x, z], idx) => {
    dummy.position.set(x, 0.6, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    trunks.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(x, 2.2, z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.setScalar(0.85 + Math.random() * 0.5);
    dummy.updateMatrix();
    crowns.setMatrixAt(idx, dummy.matrix);
    treeColor.setHSL(0.32 + Math.random() * 0.06, 0.5, 0.32 + Math.random() * 0.12);
    crowns.setColorAt(idx, treeColor);
  });
  root.add(trunks, crowns);

  // rocks
  const rocks = new InstancedMesh(
    new BoxGeometry(1, 0.7, 1),
    new MeshStandardMaterial({ color: 0x8d93a1, roughness: 1 }),
    14,
  );
  rocks.castShadow = true;
  for (let n = 0; n < 14; n++) {
    const a = Math.random() * Math.PI * 2;
    const r = 20 + Math.random() * 9;
    dummy.position.set(Math.cos(a) * r, 0.18, Math.sin(a) * r * 0.9);
    dummy.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
    dummy.scale.set(0.5 + Math.random() * 0.9, 0.4 + Math.random() * 0.5, 0.5 + Math.random() * 0.9);
    dummy.updateMatrix();
    rocks.setMatrixAt(n, dummy.matrix);
  }
  root.add(rocks);

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
