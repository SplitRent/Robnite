import { TILE } from '../core/constants';
import { FULL_QUAD_MASK, FULL_WALL_MASK, RAMP_SPIRAL, quadIndex, wallTileIndex, type BuildPieceType, type GridCoordinate, type Vec3Like } from './grid';

/**
 * EDIT MODEL
 * Walls use a 3x3 tile mask (bit set = tile present, row 0 = bottom).
 * Floors and cones use a 2x2 quadrant mask (bit = iz*2 + ix).
 * Ramps store their rising direction plus a shape (full / half / spiral).
 *
 * The ramp edit grid is Fortnite's: four large corner tiles joined by four
 * thin strips, with a hole in the middle. Cells are indexed iz*3 + ix over
 * world X/Z (index 4, the hole, is never a tile).
 */

/** Width of the thin connecting strips on the ramp edit grid. */
export const RAMP_STRIP = 0.6;
const RAMP_BIG = (TILE - RAMP_STRIP) / 2;

/** [start, end] (metres from the cell's min corner) of ramp grid column/row i. */
export function rampCellRange(i: number): [number, number] {
  if (i === 0) return [0, RAMP_BIG];
  if (i === 1) return [RAMP_BIG, RAMP_BIG + RAMP_STRIP];
  return [RAMP_BIG + RAMP_STRIP, TILE];
}

function rampAxisIndex(local: number): number {
  return local < RAMP_BIG ? 0 : local < RAMP_BIG + RAMP_STRIP ? 1 : 2;
}

/** Ramp grid cell under a world point, or -1 over the centre hole. */
export function rampCellAt(g: GridCoordinate, px: number, pz: number): number {
  const c = rampAxisIndex(pz - g.z * TILE) * 3 + rampAxisIndex(px - g.x * TILE);
  return c === 4 ? -1 : c;
}

/** Whether a ramp grid cell lies on the ramp's current (edited) shape. */
export function rampCellActive(mask: number, cell: number): boolean {
  if (mask & RAMP_SPIRAL) return true;
  const ix = cell % 3;
  const iz = Math.floor(cell / 3);
  for (const qz of iz === 1 ? [0, 1] : [iz >> 1]) {
    for (const qx of ix === 1 ? [0, 1] : [ix >> 1]) if (mask & (1 << (qz * 2 + qx))) return true;
  }
  return false;
}

/**
 * Turn a drag over the ramp grid into a ramp shape. The ramp always rises
 * toward the last tile the drag touched.
 *  - straight through the middle (strip to strip)     → full ramp
 *  - straight along a side                            → half ramp on that side
 *  - U from one corner round to the corner beside it  → spiral stairs, the
 *    first flight going up the starting side
 *  - anything else → full ramp, direction from first to last tile
 */
function rampEditFromPath(path: number[]): { mask: number; rampDir: number } | null {
  const cells = path.filter((c) => c >= 0 && c !== 4);
  if (cells.length < 2) return null;
  const f = cells[0];
  const l = cells[cells.length - 1];
  const fx = f % 3;
  const fz = Math.floor(f / 3);
  const lx = l % 3;
  const lz = Math.floor(l / 3);
  const isCorner = (x: number, z: number) => x !== 1 && z !== 1;
  const colHalf = (x: number) => (x === 0 ? 0b0101 : 0b1010);
  const rowHalf = (z: number) => (z === 0 ? 0b0011 : 0b1100);
  if (fz === lz && fx !== lx) {
    // Same row: a U through the far row is a spiral, otherwise a straight drag.
    if (isCorner(fx, fz) && isCorner(lx, lz) && cells.some((c) => Math.floor(c / 3) === 2 - fz)) {
      return { mask: RAMP_SPIRAL | colHalf(fx), rampDir: fz === 0 ? 2 : 0 };
    }
    return { mask: fz === 1 ? FULL_QUAD_MASK : rowHalf(fz), rampDir: lx > fx ? 1 : 3 };
  }
  if (fx === lx && fz !== lz) {
    if (isCorner(fx, fz) && isCorner(lx, lz) && cells.some((c) => c % 3 === 2 - fx)) {
      return { mask: RAMP_SPIRAL | rowHalf(fz), rampDir: fx === 0 ? 1 : 3 };
    }
    return { mask: fx === 1 ? FULL_QUAD_MASK : colHalf(fx), rampDir: lz > fz ? 2 : 0 };
  }
  // Diagonal: the dominant axis wins; a tie is settled by the first step.
  let dx = lx - fx;
  let dz = lz - fz;
  if (Math.abs(dx) === Math.abs(dz)) {
    const sx = (cells[1] % 3) - fx;
    const sz = Math.floor(cells[1] / 3) - fz;
    if (sx !== 0 && sz === 0) dz = 0;
    else dx = 0;
  }
  if (Math.abs(dx) > Math.abs(dz)) return { mask: FULL_QUAD_MASK, rampDir: dx > 0 ? 1 : 3 };
  return { mask: FULL_QUAD_MASK, rampDir: dz > 0 ? 2 : 0 };
}

const W = (removed: number[]) => removed.reduce((m, i) => m & ~(1 << i), FULL_WALL_MASK);
const Q = (removed: number[]) => removed.reduce((m, i) => m & ~(1 << i), FULL_QUAD_MASK);

export const WALL_PRESETS = {
  full: FULL_WALL_MASK,
  window: W([4]),
  door: W([1, 4]),
  largeOpening: W([0, 1, 2, 3, 4, 5]),
  leftOpening: W([0, 3]),
  rightOpening: W([2, 5]),
} as const;

export const FLOOR_PRESETS = {
  full: FULL_QUAD_MASK,
  cornerRemoved: Q([0]),
  half: Q([0, 1]),
  edgeOpening: Q([0, 2]),
} as const;

export const CONE_PRESETS = {
  full: FULL_QUAD_MASK,
  cornerOpening: Q([3]),
  halfCone: Q([2, 3]),
  directionalOpening: Q([0, 1]),
} as const;

export function editGridSize(type: BuildPieceType): { cols: number; rows: number } {
  return type === 'wall' || type === 'ramp' ? { cols: 3, rows: 3 } : { cols: 2, rows: 2 };
}

export function fullMask(type: BuildPieceType): number {
  return type === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK;
}

/** Tile index under a world point for a piece. */
export function tileAt(type: BuildPieceType, g: GridCoordinate, rotation: number, p: Vec3Like): number {
  if (type === 'wall') return wallTileIndex(g, rotation, p.x, p.y, p.z);
  if (type === 'ramp') return rampCellAt(g, p.x, p.z);
  return quadIndex(g, p.x, p.z);
}

/**
 * Convert a selection into the resulting edit state.
 * Walls / floors / cones: the selected tiles are removed (at least one must remain).
 * Ramps: drag across the ramp grid (see rampEditFromPath); `path` is the drag order.
 * Returns null for a selection that does not produce a valid edit.
 */
export function selectionToEdit(type: BuildPieceType, currentMask: number, selected: Set<number>, path: number[] = [...selected]): { mask: number; rampDir?: number } | null {
  if (type === 'ramp') return rampEditFromPath(path);
  let mask = fullMask(type);
  for (const i of selected) mask &= ~(1 << i);
  // Selecting tiles removes them from the full piece. At least one tile must
  // remain, and (like Fortnite) walls and floors cannot be split into
  // disconnected pieces — such an edit is rejected.
  if (mask === 0) return null;
  if (type === 'wall' && !connected(mask, 3)) return null;
  if (type === 'floor' && !connected(mask, 2)) return null;
  void currentMask;
  return { mask };
}

/** Tiles currently removed from a mask — used to pre-populate the edit selection. */
export function removedTiles(type: BuildPieceType, mask: number): Set<number> {
  const s = new Set<number>();
  const n = type === 'wall' ? 9 : 4;
  if (type === 'ramp') return s;
  for (let i = 0; i < n; i++) if (!(mask & (1 << i))) s.add(i);
  return s;
}

/** Whether the set tiles of an n x n mask form one 4-connected piece. */
function connected(mask: number, n: number): boolean {
  const cells = [];
  for (let i = 0; i < n * n; i++) if (mask & (1 << i)) cells.push(i);
  if (cells.length === 0) return false;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / n);
    const c = i % n;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
      const j = rr * n + cc;
      if (mask & (1 << j) && !seen.has(j)) {
        seen.add(j);
        stack.push(j);
      }
    }
  }
  return seen.size === cells.length;
}
