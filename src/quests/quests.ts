import { Rng } from '../core/rng';

export type QuestType =
  | 'damage'
  | 'chests'
  | 'materials'
  | 'survive'
  | 'eliminations'
  | 'wins'
  | 'materialsUsed'
  | 'visitPois'
  | 'matches'
  | 'edits'
  | 'headshots'
  | 'builds';

export interface Quest {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  goal: number;
  rewardXP: number;
  cadence: 'daily' | 'weekly';
}

export interface QuestProgress {
  id: string;
  progress: number;
  completed: boolean;
}

export interface QuestState {
  dailyKey: number;
  weeklyKey: number;
  daily: QuestProgress[];
  weekly: QuestProgress[];
}

export const QUEST_POOL: Quest[] = [
  { id: 'd_damage', title: 'Deal Damage', description: 'Deal 1,000 damage to opponents', type: 'damage', goal: 1000, rewardXP: 500, cadence: 'daily' },
  { id: 'd_chests', title: 'Open Chests', description: 'Open 5 chests or supply crates', type: 'chests', goal: 5, rewardXP: 300, cadence: 'daily' },
  { id: 'd_materials', title: 'Collect Materials', description: 'Harvest 500 materials', type: 'materials', goal: 500, rewardXP: 400, cadence: 'daily' },
  { id: 'd_survive', title: 'Survive', description: 'Survive a total of 5 minutes', type: 'survive', goal: 300, rewardXP: 300, cadence: 'daily' },
  { id: 'd_elims', title: 'Eliminate Bots', description: 'Eliminate 3 opponents', type: 'eliminations', goal: 3, rewardXP: 500, cadence: 'daily' },
  { id: 'd_builds', title: 'Build It Up', description: 'Place 50 build pieces in matches', type: 'builds', goal: 50, rewardXP: 350, cadence: 'daily' },
  { id: 'd_edits', title: 'Edit Artist', description: 'Edit 20 build pieces in matches', type: 'edits', goal: 20, rewardXP: 350, cadence: 'daily' },
  { id: 'd_matches', title: 'Drop In', description: 'Play 3 matches', type: 'matches', goal: 3, rewardXP: 300, cadence: 'daily' },
  { id: 'd_heads', title: 'Precision', description: 'Land 10 headshots', type: 'headshots', goal: 10, rewardXP: 400, cadence: 'daily' },
  { id: 'w_elims', title: 'Hunter', description: 'Get 10 eliminations', type: 'eliminations', goal: 10, rewardXP: 1500, cadence: 'weekly' },
  { id: 'w_wins', title: 'Champion', description: 'Win 2 matches', type: 'wins', goal: 2, rewardXP: 2000, cadence: 'weekly' },
  { id: 'w_matused', title: 'Master Builder', description: 'Use 1,000 materials', type: 'materialsUsed', goal: 1000, rewardXP: 1500, cadence: 'weekly' },
  { id: 'w_pois', title: 'Explorer', description: 'Visit five named locations', type: 'visitPois', goal: 5, rewardXP: 1200, cadence: 'weekly' },
  { id: 'w_damage', title: 'Heavy Hitter', description: 'Deal 5,000 damage', type: 'damage', goal: 5000, rewardXP: 1500, cadence: 'weekly' },
  { id: 'w_chests', title: 'Treasure Hunter', description: 'Open 20 chests', type: 'chests', goal: 20, rewardXP: 1200, cadence: 'weekly' },
];

export const QUEST_BY_ID = new Map(QUEST_POOL.map((q) => [q.id, q]));

export function rollQuests(cadence: 'daily' | 'weekly', key: number, count: number): QuestProgress[] {
  const rng = new Rng(`${cadence}-${key}`);
  const pool = rng.shuffle(QUEST_POOL.filter((q) => q.cadence === cadence));
  return pool.slice(0, count).map((q) => ({ id: q.id, progress: 0, completed: false }));
}

export function freshQuestState(day: number, week: number): QuestState {
  return { dailyKey: day, weeklyKey: week, daily: rollQuests('daily', day, 3), weekly: rollQuests('weekly', week, 4) };
}

/** Roll over daily/weekly quests when the day or week changes. */
export function refreshQuests(state: QuestState, day: number, week: number): boolean {
  let changed = false;
  if (state.dailyKey !== day) {
    state.dailyKey = day;
    state.daily = rollQuests('daily', day, 3);
    changed = true;
  }
  if (state.weeklyKey !== week) {
    state.weeklyKey = week;
    state.weekly = rollQuests('weekly', week, 4);
    changed = true;
  }
  return changed;
}

/**
 * Add progress of a type. For 'visitPois' pass the absolute count seen this
 * match (handled by the caller). Returns quests that just completed.
 */
export function addQuestProgress(state: QuestState, type: QuestType, amount: number): Quest[] {
  const done: Quest[] = [];
  for (const qp of [...state.daily, ...state.weekly]) {
    if (qp.completed) continue;
    const q = QUEST_BY_ID.get(qp.id);
    if (!q || q.type !== type) continue;
    qp.progress = Math.min(q.goal, qp.progress + amount);
    if (qp.progress >= q.goal) {
      qp.completed = true;
      done.push(q);
    }
  }
  return done;
}
