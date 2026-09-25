import { Vector3 } from 'three';
import { EventBus } from '../src/core/events';
import { CollisionWorld } from '../src/physics/collision';
import { BuildSystem, type BodyInfo, type BuildActor } from '../src/building/BuildSystem';
import type { GameEvents } from '../src/game/events';
import { computeBuildTarget } from '../src/building/targeting';
import type { BuildPieceType } from '../src/building/grid';
import { dirFromYawPitch } from '../src/core/math';

export function flatWorld() {
  const world = new CollisionWorld(null);
  const events = new EventBus<GameEvents>();
  const bodies: BodyInfo[] = [];
  const builds = new BuildSystem(world, events, () => bodies);
  const actor: BuildActor & BodyInfo = {
    id: 1,
    teamId: 1,
    pos: new Vector3(2, 0, 2),
    materials: { wood: 999, stone: 999, metal: 999 },
    buildMaterial: 'wood',
    unlimitedMaterials: false,
    radius: 0.38,
    height: 1.8,
    alive: true,
  };
  bodies.push(actor);
  return { world, events, builds, actor, bodies };
}

/** Build target as seen from a player standing at `pos` looking along yaw/pitch (first-person ray from the eye). */
export function targetFrom(world: CollisionWorld, builds: BuildSystem, pos: Vector3, yaw: number, pitch: number, piece: BuildPieceType, userRotation = 0) {
  const eye = new Vector3(pos.x, pos.y + 1.6, pos.z);
  const dir = dirFromYawPitch(yaw, pitch, new Vector3());
  return computeBuildTarget(world, {
    origin: eye,
    dir,
    eye,
    piece,
    userRotation,
    pieceInfo: (id) => {
      const p = builds.pieces.get(id);
      return p ? { type: p.type, grid: p.grid, rotation: p.rampDir } : null;
    },
  });
}
