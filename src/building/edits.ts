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

/**
 * Convert a selection into the resulting edit state.
 * Walls / floors / cones: the selected tiles are removed (at least one must remain).
 * Ramps (2x2, like Fortnite): drag across the tiles — the ramp rises from the
 * first tile in the direction of the drag. `path` is the drag order.
 * Returns null for a selection that does not produce a valid edit.
 */
export function selectionToEdit(type: BuildPieceType, currentMask: number, selected: Set<number>, path: number[] = [...selected]): { mask: number; rampDir?: number } | null {
  if (type === 'ramp') {
    if (path.length < 2) return null;
    // Direction of the first straight step of the drag (diagonal steps are ignored).
    for (let i = 1; i < path.length; i++) {
      const dx = (path[i] & 1) - (path[i - 1] & 1);
      const dz = (path[i] >> 1) - (path[i - 1] >> 1);
      if (dx !== 0 && dz === 0) return { mask: FULL_QUAD_MASK, rampDir: dx > 0 ? 1 : 3 };
      if (dz !== 0 && dx === 0) return { mask: FULL_QUAD_MASK, rampDir: dz > 0 ? 2 : 0 };
    }
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
