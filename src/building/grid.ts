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

/**
 * RAMP EDIT SHAPES (stored in the ramp's edit mask)
 *   0b1111                  full ramp rising toward rampDir
 *   two quadrants (half)    half-width ramp; rampDir runs along the half
 *   RAMP_SPIRAL | half      spiral stairs: the half rises toward rampDir to
 *                           mid height, the other half climbs back the
 *                           opposite way to the top
 */
export const RAMP_SPIRAL = 0x10;
/** Quadrant pairs forming a half along X (rows) and along Z (columns). */
const RAMP_HALVES_X = [0b0011, 0b1100];
const RAMP_HALVES_Z = [0b0101, 0b1010];

/** Whether an edit mask + direction is a shape a ramp can take. */
export function isValidRampEdit(mask: number, dir: number): boolean {
  if (mask === FULL_QUAD_MASK) return true;
  if (mask & ~(RAMP_SPIRAL | FULL_QUAD_MASK)) return false;
  const half = mask & FULL_QUAD_MASK;
  // A half (or a spiral flight) must run along its long axis.
  return (dir & 1) === 1 ? RAMP_HALVES_X.includes(half) : RAMP_HALVES_Z.includes(half);
}

/** 0..1 progress across the cell in the rising direction. */
function rampProgress(g: GridCoordinate, dir: number, px: number, pz: number): number {
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
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
  return Math.min(1, Math.max(0, t));
}

/** Ramp surface height at (px, pz) for a full ramp in cell g rising toward dir. */
export function rampHeight(g: GridCoordinate, dir: number, px: number, pz: number): number | null {
  return rampSurfaceHeight(g, dir, FULL_QUAD_MASK, px, pz);
}

/** Surface height of a (possibly edited) ramp; null where the ramp was cut away. */
export function rampSurfaceHeight(g: GridCoordinate, dir: number, mask: number, px: number, pz: number): number | null {
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
  const e = 0.02;
  if (px < x0 - e || px > x0 + TILE + e || pz < z0 - e || pz > z0 + TILE + e) return null;
  const y0 = g.y * TILE_H;
  const inFirst = (mask & (1 << quadIndex(g, px, pz))) !== 0;
  if (mask & RAMP_SPIRAL) {
    if (inFirst) return y0 + rampProgress(g, dir, px, pz) * TILE_H * 0.5;
    return y0 + TILE_H * 0.5 + rampProgress(g, dir + 2, px, pz) * TILE_H * 0.5;
  }
  if (!inFirst) return null;
  return y0 + rampProgress(g, dir, px, pz) * TILE_H;
}

/**
 * CONE EDITS (Fortnite): editing never cuts a cone apart. Each tile that is
 * selected (its bit cleared in the mask) lifts that outer corner up to the
 * peak, opening the cone on that side: one tile opens a corner, two
 * neighbouring tiles open a whole side, and so on.
 *
 * The roof is four triangular faces (centre + one edge each). Corner heights
 * are 0 (down) or CONE_HEIGHT (raised); the centre is always at the peak.
 */
export function coneCornerHeights(mask: number): [number, number, number, number] {
  const h = (q: number) => (mask & (1 << q) ? 0 : CONE_HEIGHT);
  return [h(0), h(1), h(2), h(3)];
}

/** Local cone height (0..CONE_HEIGHT) at local (u, v) in [0, TILE]² for a mask. */
export function coneLocalHeight(mask: number, u: number, v: number): number {
  const c = coneCornerHeights(mask);
  const T = TILE;
  const du = u - T / 2;
  const dv = v - T / 2;
  // Pick the face (edge) this point lies over, then interpolate across the
  // triangle centre → corner a → corner b. The corners of an edge are
  // interpolated linearly along it; the centre sits at the peak.
  let a: number;
  let b: number;
  let along: number; // 0..1 from corner a to corner b
  let toEdge: number; // 0 at centre, 1 at the edge
  if (Math.abs(dv) >= Math.abs(du)) {
    toEdge = Math.min(1, Math.abs(dv) / (T / 2));
    if (dv < 0) [a, b] = [c[0], c[1]];
    else [a, b] = [c[2], c[3]];
  } else {
    toEdge = Math.min(1, Math.abs(du) / (T / 2));
    if (du < 0) [a, b] = [c[0], c[2]];
    else [a, b] = [c[1], c[3]];
  }
  if (Math.abs(dv) >= Math.abs(du)) along = toEdge > 1e-6 ? (du / (T / 2) / toEdge + 1) / 2 : 0.5;
  else along = toEdge > 1e-6 ? (dv / (T / 2) / toEdge + 1) / 2 : 0.5;
  along = Math.min(1, Math.max(0, along));
  const edgeH = a + (b - a) * along;
  return CONE_HEIGHT + (edgeH - CONE_HEIGHT) * toEdge;
}

/** Cone surface height for a (possibly edited) cone; never null inside the cell. */
export function coneHeight(g: GridCoordinate, mask: number, px: number, pz: number): number | null {
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
  const e = 0.02;
  if (px < x0 - e || px > x0 + TILE + e || pz < z0 - e || pz > z0 + TILE + e) return null;
  return g.y * TILE_H + coneLocalHeight(mask, Math.min(TILE, Math.max(0, px - x0)), Math.min(TILE, Math.max(0, pz - z0)));
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
 * Removing the three tiles of a wall corner (an "L") cuts the wall along its
 * diagonal, like Fortnite's triangle / 45° edits. Returns the removed corner
 * (0 bottom-left, 1 bottom-right, 2 top-left, 3 top-right) or -1.
 * Left/right are in wall-local "along" order (col 0 = low coordinate).
 */
const WALL_CORNER_CUTS = [
  [0, 1, 3],
  [2, 1, 5],
  [6, 7, 3],
  [8, 7, 5],
].map((r) => FULL_WALL_MASK & ~r.reduce((m, i) => m | (1 << i), 0));

export function wallTriangleCorner(mask: number): number {
  return WALL_CORNER_CUTS.indexOf(mask);
}

/**
 * For a triangle-cut wall: the solid height range [lo, hi] (relative to the
 * wall base) at `a` metres along the wall.
 */
export function wallTriangleSpan(corner: number, a: number): [number, number] {
  const f = Math.min(1, Math.max(0, a / TILE));
  switch (corner) {
    case 0:
      return [TILE_H * (1 - f), TILE_H];
    case 1:
      return [TILE_H * f, TILE_H];
    case 2:
      return [0, TILE_H * f];
    default:
      return [0, TILE_H * (1 - f)];
  }
}

/**
 * Solid box pieces of a wall given its 3x3 edit mask. Vertical runs in each
 * column are merged to reduce collider count.
 */
export function wallBoxes(g: GridCoordinate, rotation: number, mask: number): AABB[] {
  const boxes: AABB[] = [];
  const half = SLAB / 2;
  const corner = wallTriangleCorner(mask);
  if (corner >= 0) {
    // Diagonal cut: approximate with thin vertical slices.
    const n = 8;
    const w = TILE / n;
    for (let i = 0; i < n; i++) {
      const [lo, hi] = wallTriangleSpan(corner, (i + 0.5) * w);
      const ya = g.y * TILE_H + lo;
      const yb = g.y * TILE_H + hi;
      if ((rotation & 1) === 0) boxes.push(makeAABB(g.x * TILE - half, ya, g.z * TILE + i * w, g.x * TILE + half, yb, g.z * TILE + (i + 1) * w));
      else boxes.push(makeAABB(g.x * TILE + i * w, ya, g.z * TILE - half, g.x * TILE + (i + 1) * w, yb, g.z * TILE + half));
    }
    return boxes;
  }
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
