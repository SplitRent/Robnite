import type { BuildMaterial } from '../building/grid';
import type { SlotItem } from '../inventory/items';

/** Explicit match flow states (no scattered booleans). */
export type MatchPhase =
  | 'LOADING'
  | 'WARMUP'
  | 'DEPLOYMENT'
  | 'ACTIVE'
  | 'STORM_PHASE'
  | 'FINAL_CIRCLE'
  | 'ROUND_END'
  | 'ELIMINATED'
  | 'VICTORY'
  | 'RESULTS';

export type ModeId = 'duel' | 'freebuild' | 'boxfight' | 'zonewar' | 'br' | 'tutorial';
export type MapId = 'hollow_ridge' | 'duel_arena' | 'box_arena' | 'zone_arena' | 'training_grounds';
export type BotDifficulty = 'easy' | 'normal' | 'hard' | 'elite';

export interface ModeConfig {
  id: ModeId;
  name: string;
  tagline: string;
  description: string;
  map: MapId;
  mapName: string;
  maxPlayers: number;
  bots: number;
  storm: boolean;
  loot: boolean;
  deployment: boolean;
  materials: 'unlimited' | Record<BuildMaterial, number>;
  unlimitedAmmo: boolean;
  loadout: SlotItem[];
  startShield: number;
  fallDamage: boolean;
  /** Rounds needed to win (0 = single life / no rounds). */
  roundsToWin: number;
  respawn: 'none' | 'round' | 'manual';
  durationLabel: string;
  accent: string;
  /** Freebuild-style training content. */
  training: boolean;
}

export interface MatchResult {
  mode: ModeId;
  modeName: string;
  won: boolean;
  placement: number;
  totalPlayers: number;
  eliminations: number;
  damage: number;
  damageTaken: number;
  headshots: number;
  survivalTime: number;
  builds: number;
  edits: number;
  materialsGathered: number;
  materialsUsed: number;
  chestsOpened: number;
  poisVisited: string[];
  roundsWon: number;
  roundsLost: number;
  timestamp: number;
}
