import { Vector3 } from 'three';
import { MAX_HEALTH, PLAYER_HEIGHT, PLAYER_RADIUS } from '../core/constants';
import type { BuildActor, BodyInfo } from '../building/BuildSystem';
import type { BuildMaterial, BuildPieceType } from '../building/grid';
import { Inventory } from '../inventory/Inventory';
import { emptyInput, type PlayerInput } from '../networking/protocol';

export type AirState = 'none' | 'bus' | 'skydive' | 'glide';

export interface CombatantStats {
  eliminations: number;
  damageDealt: number;
  damageTaken: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  buildsPlaced: number;
  materialsUsed: number;
  edits: number;
  materialsGathered: number;
  chestsOpened: number;
  poisVisited: Set<string>;
  survivalTime: number;
}

export interface CosmeticLoadout {
  outfit: string;
  backpack: string;
  pickaxe: string;
  glider: string;
  wrap: string;
  emote: string;
}

export function freshStats(): CombatantStats {
  return {
    eliminations: 0,
    damageDealt: 0,
    damageTaken: 0,
    headshots: 0,
    shotsFired: 0,
    shotsHit: 0,
    buildsPlaced: 0,
    materialsUsed: 0,
    edits: 0,
    materialsGathered: 0,
    chestsOpened: 0,
    poisVisited: new Set(),
    survivalTime: 0,
  };
}

/** Shared state for human players and bots. */
export class Combatant implements BuildActor, BodyInfo {
  pos = new Vector3();
  vel = new Vector3();
  yaw = 0;
  pitch = 0;
  radius = PLAYER_RADIUS;
  height = PLAYER_HEIGHT;
  grounded = false;
  crouching = false;
  sprinting = false;
  slideTimer = 0;
  /** Seconds the player has been falling (for landing effects). */
  airTime = 0;
  air: AirState = 'none';

  health = MAX_HEALTH;
  shield = 0;
  alive = true;
  placement = 0;
  deathTime = 0;
  killerId = -1;
  lastAttackerId = -1;
  lastDamagedAt = -99;

  inventory = new Inventory();
  materials: Record<BuildMaterial, number> = { wood: 0, stone: 0, metal: 0 };
  buildMaterial: BuildMaterial = 'wood';
  unlimitedMaterials = false;
  buildPiece: BuildPieceType | null = null;
  buildRotation = 0;
  /** Piece currently being edited (set by the edit action flow). */
  editingPieceId = -1;

  fireCooldown = 0;
  reloadTimer = 0;
  reloadSlot = -1;
  bloom = 0;
  switchTimer = 0;
  useTimer = 0;
  useSlot = -1;
  emoteId = '';
  emoteTimer = 0;
  lastShotAt = -99;
  lastSwingAt = -99;
  lastBuildAt = -99;
  lastHitAt = -99;
  /** Accumulated camera recoil to apply on the client. */
  recoilPitch = 0;
  recoilYaw = 0;

  input: PlayerInput = emptyInput();
  stats: CombatantStats = freshStats();
  roundWins = 0;

  cosmetics: CosmeticLoadout = { outfit: 'default', backpack: 'none', pickaxe: 'default', glider: 'default', wrap: 'none', emote: 'wave' };

  constructor(
    public id: number,
    public name: string,
    public isBot: boolean,
    public teamId: number,
  ) {}

  get unlimitedAmmo(): boolean {
    return this.inventory.unlimitedAmmo;
  }

  get eyeHeight(): number {
    return this.height - 0.2;
  }

  eye(out = new Vector3()): Vector3 {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  chest(out = new Vector3()): Vector3 {
    return out.set(this.pos.x, this.pos.y + this.height * 0.68, this.pos.z);
  }

  get busy(): boolean {
    return this.useTimer > 0;
  }

  get totalMaterials(): number {
    return this.materials.wood + this.materials.stone + this.materials.metal;
  }

  resetForRound(): void {
    this.vel.set(0, 0, 0);
    this.health = MAX_HEALTH;
    this.alive = true;
    this.air = 'none';
    this.buildPiece = null;
    this.editingPieceId = -1;
    this.fireCooldown = 0;
    this.reloadTimer = 0;
    this.reloadSlot = -1;
    this.useTimer = 0;
    this.useSlot = -1;
    this.bloom = 0;
    this.emoteTimer = 0;
    this.crouching = false;
    this.slideTimer = 0;
    this.lastAttackerId = -1;
  }
}
