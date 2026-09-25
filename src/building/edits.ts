import { TILE, TILE_H } from '../core/constants';
import { FULL_QUAD_MASK, FULL_WALL_MASK, quadIndex, wallTileIndex, type BuildPieceType, type GridCoordinate, type Vec3Like } from './grid';

/**
 * EDIT MODEL
 * Walls use a 3x3 tile mask (bit set = tile present, row 0 = bottom).
 * Floors and cones use a 2x2 quadrant mask (bit = iz*2 + ix).
 * Ramps store their rising direction; an edit selects the edge to rise toward.
 */

const W = (removed: number[]) => removed.reduce((m, i) => m & ~(1 << i), FULL_WALL_MASK);
const Q = (removed: number[]) => removed.reduce((m, i) => m & ~(1 << i), FULL_QUAD_MASK);

export const WALL_PRESETS = {
  full: FULL_WALL_MASK,
  window: W([4]),
  door: W([1, 4]),
  largeOpening: W([0, 1, 2, 3, 4, 5]),
  leftOpening: W([0, 3]),
  rightOpening: W([2, 5]),
  horizontalOpening: W([3, 4, 5]),
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
  return type === 'wall' ? { cols: 3, rows: 3 } : { cols: 2, rows: 2 };
}

export function fullMask(type: BuildPieceType): number {
  return type === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK;
}

/** Tile index under a world point for a piece. */
export function tileAt(type: BuildPieceType, g: GridCoordinate, rotation: number, p: Vec3Like): number {
  if (type === 'wall') return wallTileIndex(g, rotation, p.x, p.y, p.z);
  return quadIndex(g, p.x, p.z);
}

/** World-space centre of each edit tile (for drawing the edit grid). */
export function tileCenters(type: BuildPieceType, g: GridCoordinate, rotation: number, surfaceY: (x: number, z: number) => number): Vec3Like[] {
  const out: Vec3Like[] = [];
  if (type === 'wall') {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const y = g.y * TILE_H + (row + 0.5) * (TILE_H / 3);
        const along = (col + 0.5) * (TILE / 3);
        if ((rotation & 1) === 0) out.push({ x: g.x * TILE, y, z: g.z * TILE + along });
        else out.push({ x: g.x * TILE + along, y, z: g.z * TILE });
      }
    }
  } else {
    for (let q = 0; q < 4; q++) {
      const x = g.x * TILE + ((q & 1) + 0.5) * (TILE / 2);
      const z = g.z * TILE + ((q >> 1) + 0.5) * (TILE / 2);
      out.push({ x, y: surfaceY(x, z), z });
    }
  }
  return out;
}

/**
 * Convert a set of selected tiles into the resulting edit state.
 * Returns null for a selection that does not produce a valid edit.
 */
export function selectionToEdit(type: BuildPieceType, currentMask: number, selected: Set<number>): { mask: number; rampDir?: number } | null {
  if (type === 'ramp') {
    if (selected.size !== 2) return null;
    const [a, b] = [...selected].sort();
    // Quad indices: 0 (x0,z0) 1 (x1,z0) 2 (x0,z1) 3 (x1,z1)
    if (a === 0 && b === 1) return { mask: FULL_QUAD_MASK, rampDir: 0 }; // low-Z edge → rise toward -Z
    if (a === 2 && b === 3) return { mask: FULL_QUAD_MASK, rampDir: 2 };
    if (a === 1 && b === 3) return { mask: FULL_QUAD_MASK, rampDir: 1 };
    if (a === 0 && b === 2) return { mask: FULL_QUAD_MASK, rampDir: 3 };
    return null;
  }
  let mask = fullMask(type);
  for (const i of selected) mask &= ~(1 << i);
  // Selecting tiles removes them from the full piece. At least one tile must remain.
  if (mask === 0) return null;
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
