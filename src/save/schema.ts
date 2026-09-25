import { DEFAULT_EQUIPPED, DEFAULT_OWNED, type EquippedMap } from '../cosmetics/catalog';
import { DEFAULT_BINDINGS, type KeybindConfig } from '../input/bindings';
import { defaultSettings, type Settings } from '../settings/settings';
import { freshQuestState, type QuestState } from '../quests/quests';
import type { MatchResult, ModeId } from '../game/matchTypes';
import { dayIndex, weekIndex } from '../core/rng';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'robnite.save';

export interface PlayerStats {
  matches: number;
  wins: number;
  eliminations: number;
  deaths: number;
  damage: number;
  bestPlacement: number;
  buildsPlaced: number;
  edits: number;
  playTime: number;
  headshots: number;
  chestsOpened: number;
  materialsGathered: number;
  modeCounts: Partial<Record<ModeId, number>>;
}

export interface MatchRecord extends MatchResult {
  xp: number;
  credits: number;
}

export interface PlayerProfile {
  id: string;
  displayName: string;
  level: number;
  /** XP into the current level. */
  xp: number;
  totalXp: number;
  currency: number;
  inventory: string[];
  equipped: EquippedMap;
  createdAt: number;
}

export interface BattlePassState {
  seasonId: string;
  xp: number;
  level: number;
  premium: boolean;
  claimedFree: number[];
  claimedPremium: number[];
  xpBoost: number;
}

export interface SaveData {
  version: number;
  profileCreated: boolean;
  profile: PlayerProfile;
  settings: Settings;
  keybinds: KeybindConfig;
  stats: PlayerStats;
  matchHistory: MatchRecord[];
  quests: QuestState;
  battlePass: BattlePassState;
  login: { lastDay: number; streak: number };
  redeemed: string[];
  tutorial: { completed: boolean; skipped: boolean; offered: boolean };
  seenNews: string[];
}

export function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    profileCreated: false,
    profile: {
      id: randomId(),
      displayName: 'Player',
      level: 1,
      xp: 0,
      totalXp: 0,
      currency: 500,
      inventory: [...DEFAULT_OWNED],
      equipped: { ...DEFAULT_EQUIPPED },
      createdAt: Date.now(),
    },
    settings: defaultSettings(),
    keybinds: structuredClone(DEFAULT_BINDINGS),
    stats: {
      matches: 0,
      wins: 0,
      eliminations: 0,
      deaths: 0,
      damage: 0,
      bestPlacement: 0,
      buildsPlaced: 0,
      edits: 0,
      playTime: 0,
      headshots: 0,
      chestsOpened: 0,
      materialsGathered: 0,
      modeCounts: {},
    },
    matchHistory: [],
    quests: freshQuestState(dayIndex(), weekIndex()),
    battlePass: { seasonId: 's01', xp: 0, level: 1, premium: false, claimedFree: [], claimedPremium: [], xpBoost: 0 },
    login: { lastDay: 0, streak: 0 },
    redeemed: [],
    tutorial: { completed: false, skipped: false, offered: false },
    seenNews: [],
  };
}

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merge loaded data over defaults: every field missing or of the wrong type
 * falls back to the default, so one bad field never corrupts the whole save.
 */
export function mergeDefaults<T>(defaults: T, loaded: unknown): T {
  if (!isPlain(defaults)) {
    if (Array.isArray(defaults)) return (Array.isArray(loaded) ? loaded : defaults) as T;
    return (typeof loaded === typeof defaults && loaded !== null ? loaded : defaults) as T;
  }
  if (!isPlain(loaded)) return defaults;
  const out: Plain = { ...(defaults as Plain) };
  for (const key of Object.keys(defaults as Plain)) {
    const d = (defaults as Plain)[key];
    const l = loaded[key];
    if (l === undefined) continue;
    if (isPlain(d)) {
      // Records with dynamic keys (modeCounts) keep loaded keys too.
      out[key] = Object.keys(d).length === 0 && isPlain(l) ? { ...l } : mergeDefaults(d, l);
    } else out[key] = mergeDefaults(d, l);
  }
  return out as T;
}

/** Ordered migrations: index n upgrades a version-n save to n+1. */
export const MIGRATIONS: ((data: Plain) => Plain)[] = [
  // v0 → v1: pre-release saves stored the display name at the top level.
  (d) => {
    if (typeof d.displayName === 'string') {
      const profile = isPlain(d.profile) ? d.profile : {};
      profile.displayName = d.displayName;
      d.profile = profile;
      delete d.displayName;
    }
    d.version = 1;
    return d;
  },
  // v1 → v2: FOV became horizontal (Fortnite-style) and the camera was
  // re-framed; drop the old camera distance / shoulder so the new defaults apply.
  (d) => {
    const gp = isPlain(d.settings) && isPlain(d.settings.gameplay) ? d.settings.gameplay : null;
    if (gp) {
      delete gp.cameraDistance;
      delete gp.shoulderOffset;
    }
    d.version = 2;
    return d;
  },
];

export function migrate(raw: Plain): Plain {
  let v = typeof raw.version === 'number' ? raw.version : 0;
  let data = raw;
  while (v < SAVE_VERSION && MIGRATIONS[v]) {
    data = MIGRATIONS[v](data);
    v++;
    data.version = v;
  }
  return data;
}
