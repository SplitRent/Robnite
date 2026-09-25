import type { BuildPieceType, Vec3Like } from '../building/grid';
import type { BuildTarget } from '../building/targeting';

/**
 * Per-tick input for one combatant. Human players produce it from the
 * keyboard/mouse; bots produce the same struct from their brain. A future
 * network server would receive exactly this.
 */
export interface PlayerInput {
  forward: number;
  right: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  aim: boolean;
  yaw: number;
  pitch: number;
  /** Aim ray origin (camera for humans, eye for bots). */
  rayOrigin: Vec3Like;
  /** Normalised aim direction. */
  rayDir: Vec3Like;
}

export function emptyInput(): PlayerInput {
  return {
    forward: 0,
    right: 0,
    jump: false,
    sprint: false,
    crouch: false,
    fire: false,
    aim: false,
    yaw: 0,
    pitch: 0,
    rayOrigin: { x: 0, y: 0, z: 0 },
    rayDir: { x: 0, y: 0, z: -1 },
  };
}

/** Discrete actions (edge-triggered). */
export type GameAction =
  | { type: 'selectSlot'; slot: number }
  | { type: 'selectPickaxe' }
  | { type: 'cycleWeapon'; delta: number }
  | { type: 'selectBuild'; piece: BuildPieceType }
  | { type: 'exitBuild' }
  | { type: 'rotateBuild' }
  | { type: 'cycleMaterial' }
  | { type: 'place'; target: BuildTarget }
  | { type: 'edit'; pieceId: number; mask: number; rampDir?: number }
  | { type: 'resetEdit'; pieceId: number }
  | { type: 'reload' }
  | { type: 'interact' }
  | { type: 'toggleGlider' }
  | { type: 'jumpFromBus' }
  | { type: 'emote'; emoteId: string }
  | { type: 'dropSlot'; slot: number }
  | { type: 'respawn' }
  | { type: 'resetBuilds' };
