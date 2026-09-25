import type { BuildPiece } from '../building/BuildSystem';
import type { Vec3Like } from '../building/grid';
import type { ItemStack } from '../inventory/items';
import type { MatchPhase, MatchResult } from './matchTypes';

export type DamageSource = 'weapon' | 'pickaxe' | 'storm' | 'fall' | 'bounds';

export interface GameEvents {
  BUILD_PLACED: { piece: BuildPiece };
  BUILD_DAMAGED: { piece: BuildPiece; amount: number; attackerId: number; point: Vec3Like | null };
  BUILD_DESTROYED: { piece: BuildPiece; reason: 'damage' | 'collapse' | 'reset' };
  BUILD_EDITED: { piece: BuildPiece; byId: number };
  BUILD_EDIT_RESET: { piece: BuildPiece; byId: number };
  SHOT_FIRED: { shooterId: number; weapon: string; from: Vec3Like; to: Vec3Like; hitCharacter: boolean };
  IMPACT: { point: Vec3Like; normal: Vec3Like; material: string; shooterId: number };
  PLAYER_DAMAGE: {
    targetId: number;
    attackerId: number;
    amount: number;
    shieldDamage: number;
    healthDamage: number;
    headshot: boolean;
    point: Vec3Like;
    source: DamageSource;
  };
  PLAYER_ELIMINATED: { victimId: number; killerId: number; weapon: string; source: DamageSource; placement: number };
  PLAYER_HEALED: { combatantId: number; health: number; shield: number };
  ITEM_PICKED_UP: { combatantId: number; item: ItemStack };
  ITEM_USED: { combatantId: number; itemId: string };
  CHEST_OPENED: { combatantId: number; chestId: number; point: Vec3Like };
  RESOURCE_HIT: { combatantId: number; resourceId: number; amount: number; material: string; point: Vec3Like; destroyed: boolean };
  RELOAD_START: { combatantId: number; weapon: string };
  RELOAD_END: { combatantId: number; weapon: string };
  WEAPON_SWITCH: { combatantId: number; weapon: string };
  PICKAXE_SWING: { combatantId: number };
  JUMP: { combatantId: number };
  LANDED: { combatantId: number; speed: number };
  GLIDER: { combatantId: number; open: boolean };
  DOOR_TOGGLED: { doorId: number; open: boolean; point: Vec3Like };
  EMOTE: { combatantId: number; emoteId: string };
  POI_VISITED: { combatantId: number; poi: string };
  MATCH_PHASE: { phase: MatchPhase };
  MATCH_ENDED: { result: MatchResult };
  ROUND_STARTED: { round: number };
  ROUND_ENDED: { round: number; winnerId: number };
  STORM_PHASE: { phase: number; message: string };
  NOTICE: { text: string; kind: 'info' | 'warn' | 'good' };
}
