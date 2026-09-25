import { Vector3 } from 'three';
import { BUILD_RANGE, TILE, TILE_H } from '../core/constants';
import type { CollisionWorld, RayHit } from '../physics/collision';
import { faceLabel, lookDirIndex, slotKey, type BuildPieceType, type GridCoordinate, type Vec3Like } from './grid';

export interface BuildTarget {
  piece: BuildPieceType;
  grid: GridCoordinate;
  /**
   * wall: 0 = plane X (spans Z), 1 = plane Z (spans X)
   * ramp: rising direction 0:-Z 1:+X 2:+Z 3:-X
   * cone: orientation 0..3, floor: 0
   */
  rotation: number;
  key: string;
  /** Debug: surface normal and raw hit point that produced this target. */
  normal: Vec3Like;
  hitPoint: Vec3Like;
  face: string;
  /** True when the ray hit nothing and the air point was used. */
  air: boolean;
  valid: boolean;
  reason: string;
}

export interface TargetInput {
  /** Camera position. */
  origin: Vec3Like;
  /** Normalised crosshair direction (camera forward). */
  dir: Vec3Like;
  /** Player eye position — used to skip geometry between camera and player. */
  eye: Vec3Like;
  piece: BuildPieceType;
  /** Extra quarter turns chosen with the rotate key. */
  userRotation: number;
  /** Look up the piece type/grid for a build collider ref (piece id). */
  pieceInfo?: (pieceId: number) => { type: BuildPieceType; grid: GridCoordinate; rotation: number } | null;
}

/** Distance ahead of the player used when the crosshair hits nothing. */
export const AIR_TARGET_DISTANCE = TILE * 1.25;
/** A wall line is chosen when the crosshair point is within this fraction of a tile before it. */
const WALL_FORWARD_BIAS = 0.75;

const o = new Vector3();
const d = new Vector3();

/**
 * Resolve the build target under the crosshair. Pure and deterministic:
 * identical camera/world state always yields the identical target.
 *
 *   camera → centre-screen ray → hit point + normal → cell → snapped slot
 */
export function computeBuildTarget(world: CollisionWorld, input: TargetInput): BuildTarget {
  o.set(input.origin.x, input.origin.y, input.origin.z);
  d.set(input.dir.x, input.dir.y, input.dir.z).normalize();
  // Start the ray at the player's depth so geometry behind the player (between
  // the third-person camera and the character) never captures the target.
  const toEye = (input.eye.x - o.x) * d.x + (input.eye.y - o.y) * d.y + (input.eye.z - o.z) * d.z;
  const t0 = Math.max(0, toEye - 0.25);
  const start = new Vector3().copy(o).addScaledVector(d, t0);
  const hit: RayHit | null = world.raycast(start, d, BUILD_RANGE + 2);

  let p: Vector3;
  let normal: Vector3;
  let air = false;
  if (hit) {
    p = hit.point;
    normal = hit.normal;
  } else {
    air = true;
    const airDist = Math.max(0, toEye - t0) + AIR_TARGET_DISTANCE;
    p = start.clone().addScaledVector(d, airDist);
    normal = d.clone().negate();
  }
  // Q: a point just in front of the hit surface, on the viewer's side.
  const q = p.clone().addScaledVector(d, -0.02);

  const look = lookDirIndex(d.x, d.z);
  const piece = input.piece;
  let grid: GridCoordinate;
  let rotation = 0;

  switch (piece) {
    case 'floor': {
      grid = { x: Math.floor(q.x / TILE), y: Math.round(q.y / TILE_H), z: Math.floor(q.z / TILE) };
      const ground = world.terrainHeight((grid.x + 0.5) * TILE, (grid.z + 0.5) * TILE);
      if (ground > grid.y * TILE_H + 0.35) grid.y += 1;
      break;
    }
    case 'wall': {
      const alongX = look === 1 || look === 3;
      // Crosshair point → nearest wall line, biased forward along the look axis.
      const lineIndex = (coord: number, positive: boolean) =>
        positive ? Math.ceil(coord / TILE - (1 - WALL_FORWARD_BIAS)) : Math.floor(coord / TILE + (1 - WALL_FORWARD_BIAS));
      let y = Math.floor((q.y + 0.05) / TILE_H);
      if (alongX) {
        rotation = (0 + input.userRotation) & 1;
        grid = rotation === 0
          ? { x: lineIndex(q.x, look === 1), y, z: Math.floor(q.z / TILE) }
          : { x: Math.floor(q.x / TILE), y, z: lineIndex(q.z, d.z > 0) };
      } else {
        rotation = (1 + input.userRotation) & 1;
        grid = rotation === 1
          ? { x: Math.floor(q.x / TILE), y, z: lineIndex(q.z, look === 2) }
          : { x: lineIndex(q.x, d.x > 0), y, z: Math.floor(q.z / TILE) };
      }
      const cx = rotation === 0 ? grid.x * TILE : (grid.x + 0.5) * TILE;
      const cz = rotation === 0 ? (grid.z + 0.5) * TILE : grid.z * TILE;
      const ground = world.terrainHeight(cx, cz);
      if (ground > grid.y * TILE_H + TILE_H * 0.6) y += 1;
      grid.y = y;
      break;
    }
    case 'ramp': {
      grid = { x: Math.floor(q.x / TILE), y: Math.floor((q.y + 0.05) / TILE_H), z: Math.floor(q.z / TILE) };
      rotation = (look + input.userRotation) & 3;
      // Aiming at the surface of an existing ramp that rises the same way:
      // continue the ramp chain one cell forward and one level up.
      const col = hit?.collider;
      if (col && col.owner === 'build' && input.pieceInfo) {
        const info = input.pieceInfo(col.ref);
        if (info && info.type === 'ramp' && info.grid.x === grid.x && info.grid.y === grid.y && info.grid.z === grid.z && info.rotation === rotation) {
          grid = { x: grid.x + dirX(rotation), y: grid.y + 1, z: grid.z + dirZ(rotation) };
        }
      }
      const ground = world.terrainHeight((grid.x + 0.5) * TILE, (grid.z + 0.5) * TILE);
      if (ground > grid.y * TILE_H + TILE_H * 0.5) grid.y += 1;
      break;
    }
    case 'cone': {
      grid = { x: Math.floor(q.x / TILE), y: Math.round(q.y / TILE_H), z: Math.floor(q.z / TILE) };
      rotation = (look + input.userRotation) & 3;
      const ground = world.terrainHeight((grid.x + 0.5) * TILE, (grid.z + 0.5) * TILE);
      if (ground > grid.y * TILE_H + 0.35) grid.y += 1;
      break;
    }
  }

  return {
    piece,
    grid,
    rotation,
    key: slotKey(piece, grid, rotation),
    normal: { x: normal.x, y: normal.y, z: normal.z },
    hitPoint: { x: p.x, y: p.y, z: p.z },
    face: air ? 'AIR' : faceLabel(normal),
    air,
    valid: true,
    reason: '',
  };
}

function dirX(dir: number): number {
  return dir === 1 ? 1 : dir === 3 ? -1 : 0;
}
function dirZ(dir: number): number {
  return dir === 2 ? 1 : dir === 0 ? -1 : 0;
}

/** Construct a target directly from grid data (used by bots and tests). */
export function makeTarget(piece: BuildPieceType, grid: GridCoordinate, rotation: number): BuildTarget {
  return {
    piece,
    grid: { ...grid },
    rotation: piece === 'wall' ? rotation & 1 : piece === 'floor' ? 0 : rotation & 3,
    key: slotKey(piece, grid, rotation),
    normal: { x: 0, y: 1, z: 0 },
    hitPoint: { x: 0, y: 0, z: 0 },
    face: 'DIRECT',
    air: false,
    valid: true,
    reason: '',
  };
}
