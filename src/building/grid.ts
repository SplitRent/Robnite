import { SLAB, TILE, TILE_H } from '../core/constants';
import { makeAABB, type AABB } from '../physics/collision';

/**
 * GLOBAL BUILD GRID
 * -----------------
 * The world is divided into cells of TILE x TILE_H x TILE metres. Cell
 * (x, y, z) spans [x*TILE, (x+1)*TILE] x [y*TILE_H, (y+1)*TILE_H] x [z*TILE, (z+1)*TILE].
 *
 * Slots:
 *   floor  F:x:y:z     horizontal slab at height y*TILE_H covering cell (x, z)
 *   wall   W:x:y:z:a   vertical slab; a=0 → plane X = x*TILE spanning z-cell z,
 *                                    a=1 → plane Z = z*TILE spanning x-cell x
 *   ramp / cone V:x:y:z  occupy the volume of cell (x, y, z)
 *
 * Everything below is pure math — no scene graph positions are used.
 */

export type BuildPieceType = 'wall' | 'floor' | 'ramp' | 'cone';
export type BuildMaterial = 'wood' | 'stone' | 'metal';
export const BUILD_MATERIALS: readonly BuildMaterial[] = ['wood', 'stone', 'metal'];
export const PIECE_TYPES: readonly BuildPieceType[] = ['wall', 'floor', 'ramp', 'cone'];

export interface GridCoordinate {
  x: number;
  y: number;
  z: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Ramp rising direction index → unit vector on XZ (0:-Z, 1:+X, 2:+Z, 3:-X). */
export const DIR_VECTORS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** Peak height of a cone above its base. */
export const CONE_HEIGHT = TILE_H * 0.5;

export const FULL_WALL_MASK = 0x1ff;
export const FULL_QUAD_MASK = 0xf;

export interface MaterialStats {
  maxHealth: number;
  /** Seconds for a piece to reach full health. Collision is immediate. */
  buildTime: number;
  cost: number;
}

export const MATERIAL_STATS: Record<BuildMaterial, MaterialStats> = {
  wood: { maxHealth: 150, buildTime: 0.5, cost: 10 },
  stone: { maxHealth: 300, buildTime: 0.9, cost: 10 },
  metal: { maxHealth: 500, buildTime: 1.4, cost: 10 },
};

/** Health a piece starts with, as a fraction of max health. */
export const BUILD_START_HEALTH = 0.3;

export function slotKey(piece: BuildPieceType, g: GridCoordinate, rotation: number): string {
  switch (piece) {
    case 'wall':
      return `W:${g.x}:${g.y}:${g.z}:${rotation & 1}`;
    case 'floor':
      return `F:${g.x}:${g.y}:${g.z}`;
    default:
      return `V:${g.x}:${g.y}:${g.z}`;
  }
}

/** World-space bounds of a (full, unedited) piece. */
export function pieceBounds(piece: BuildPieceType, g: GridCoordinate, rotation: number): AABB {
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
  const y0 = g.y * TILE_H;
  const half = SLAB / 2;
  switch (piece) {
    case 'floor':
      return makeAABB(x0, y0 - half, z0, x0 + TILE, y0 + half, z0 + TILE);
    case 'wall':
      if ((rotation & 1) === 0) return makeAABB(x0 - half, y0, z0, x0 + half, y0 + TILE_H, z0 + TILE);
      return makeAABB(x0, y0, z0 - half, x0 + TILE, y0 + TILE_H, z0 + half);
    case 'ramp':
      return makeAABB(x0, y0, z0, x0 + TILE, y0 + TILE_H, z0 + TILE);
    case 'cone':
      return makeAABB(x0, y0, z0, x0 + TILE, y0 + CONE_HEIGHT, z0 + TILE);
  }
}

export function pieceCenter(piece: BuildPieceType, g: GridCoordinate, rotation: number): Vec3Like {
  const b = pieceBounds(piece, g, rotation);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
}

/** Ramp surface height at (px, pz) for a ramp in cell g rising toward dir. */
export function rampHeight(g: GridCoordinate, dir: number, px: number, pz: number): number | null {
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
  const e = 0.02;
  if (px < x0 - e || px > x0 + TILE + e || pz < z0 - e || pz > z0 + TILE + e) return null;
  let t: number;
  switch (dir & 3) {
    case 0:
      t = (z0 + TILE - pz) / TILE;
      break;
    case 1:
      t = (px - x0) / TILE;
      break;
    case 2:
      t = (pz - z0) / TILE;
      break;
    default:
      t = (x0 + TILE - px) / TILE;
  }
  t = Math.min(1, Math.max(0, t));
  return g.y * TILE_H + t * TILE_H;
}

/** Cone (pyramid roof) height; quadrants removed by edits return null. */
export function coneHeight(g: GridCoordinate, mask: number, px: number, pz: number): number | null {
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
  const e = 0.02;
  if (px < x0 - e || px > x0 + TILE + e || pz < z0 - e || pz > z0 + TILE + e) return null;
  const q = quadIndex(g, px, pz);
  if (!(mask & (1 << q))) return null;
  const u = Math.abs((px - (x0 + TILE / 2)) / TILE);
  const v = Math.abs((pz - (z0 + TILE / 2)) / TILE);
  const m = Math.min(0.5, Math.max(u, v));
  return g.y * TILE_H + CONE_HEIGHT * (1 - 2 * m);
}

/** 2x2 quadrant index (iz*2 + ix) for floors, cones and ramps. */
export function quadIndex(g: GridCoordinate, px: number, pz: number): number {
  const ix = Math.min(1, Math.max(0, Math.floor((px - g.x * TILE) / (TILE / 2))));
  const iz = Math.min(1, Math.max(0, Math.floor((pz - g.z * TILE) / (TILE / 2))));
  return iz * 2 + ix;
}

/** 3x3 wall tile index (row*3 + col), row 0 = bottom. */
export function wallTileIndex(g: GridCoordinate, rotation: number, px: number, py: number, pz: number): number {
  const along = (rotation & 1) === 0 ? pz - g.z * TILE : px - g.x * TILE;
  const col = Math.min(2, Math.max(0, Math.floor(along / (TILE / 3))));
  const row = Math.min(2, Math.max(0, Math.floor((py - g.y * TILE_H) / (TILE_H / 3))));
  return row * 3 + col;
}

/**
 * Solid box pieces of a wall given its 3x3 edit mask. Vertical runs in each
 * column are merged to reduce collider count.
 */
export function wallBoxes(g: GridCoordinate, rotation: number, mask: number): AABB[] {
  const boxes: AABB[] = [];
  const half = SLAB / 2;
  const tw = TILE / 3;
  const th = TILE_H / 3;
  const y0 = g.y * TILE_H;
  for (let col = 0; col < 3; col++) {
    let row = 0;
    while (row < 3) {
      if (!(mask & (1 << (row * 3 + col)))) {
        row++;
        continue;
      }
      let end = row;
      while (end + 1 < 3 && mask & (1 << ((end + 1) * 3 + col))) end++;
      const ya = y0 + row * th;
      const yb = y0 + (end + 1) * th;
      if ((rotation & 1) === 0) {
        const x = g.x * TILE;
        const za = g.z * TILE + col * tw;
        boxes.push(makeAABB(x - half, ya, za, x + half, yb, za + tw));
      } else {
        const z = g.z * TILE;
        const xa = g.x * TILE + col * tw;
        boxes.push(makeAABB(xa, ya, z - half, xa + tw, yb, z + half));
      }
      row = end + 1;
    }
  }
  return boxes;
}

export function floorBoxes(g: GridCoordinate, mask: number): AABB[] {
  const boxes: AABB[] = [];
  const half = SLAB / 2;
  const hw = TILE / 2;
  const y = g.y * TILE_H;
  if (mask === FULL_QUAD_MASK) {
    return [makeAABB(g.x * TILE, y - half, g.z * TILE, g.x * TILE + TILE, y + half, g.z * TILE + TILE)];
  }
  for (let q = 0; q < 4; q++) {
    if (!(mask & (1 << q))) continue;
    const ix = q & 1;
    const iz = q >> 1;
    const xa = g.x * TILE + ix * hw;
    const za = g.z * TILE + iz * hw;
    boxes.push(makeAABB(xa, y - half, za, xa + hw, y + half, za + hw));
  }
  return boxes;
}

export function countBits(n: number): number {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

export function faceLabel(n: Vec3Like): string {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  if (ay >= ax && ay >= az) return n.y >= 0 ? '+Y' : '-Y';
  if (ax >= az) return n.x >= 0 ? '+X' : '-X';
  return n.z >= 0 ? '+Z' : '-Z';
}

/** Dominant horizontal look direction → ramp dir index (0:-Z, 1:+X, 2:+Z, 3:-X). */
export function lookDirIndex(dx: number, dz: number): number {
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3;
  return dz > 0 ? 2 : 0;
}
