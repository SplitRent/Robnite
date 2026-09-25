import { COSMETICS } from '../cosmetics/catalog';

export interface BattlePassReward {
  level: number;
  freeReward?: string;
  premiumReward?: string;
}

export interface SeasonConfig {
  id: string;
  name: string;
  number: number;
  theme: string;
  startDate: string;
  endDate: string;
  battlePass: BattlePassReward[];
  premiumPrice: number;
  shopPool: string[];
  mapChanges: string[];
}

export const BP_TIERS = 50;
export const BP_XP_PER_TIER = 2500;

/**
 * Reward strings: a cosmetic id, "credits:N" or "xpboost:N" (percent bonus
 * to match XP — progression only, never gameplay power).
 */
function buildRewards(): BattlePassReward[] {
  const bp = COSMETICS.filter((c) => c.source === 'battlepass');
  const find = (id: string) => bp.find((c) => c.id === id)?.id;
  const fixed: Record<number, BattlePassReward> = {
    1: { level: 1, freeReward: 'credits:100', premiumReward: find('outfit_fallen_vanguard') },
    5: { level: 5, freeReward: find('banner_picks'), premiumReward: find('pickaxe_quarry') },
    10: { level: 10, freeReward: find('emote_celebrate'), premiumReward: find('outfit_quarry_boss') },
    15: { level: 15, freeReward: 'credits:200', premiumReward: find('glider_leaf') },
    20: { level: 20, freeReward: find('backpack_crate'), premiumReward: find('outfit_lab_rat') },
    25: { level: 25, freeReward: find('banner_tree'), premiumReward: find('wrap_circuit') },
    30: { level: 30, freeReward: find('loading_iron'), premiumReward: find('emote_spin') },
    35: { level: 35, freeReward: 'credits:300', premiumReward: find('backpack_fins') },
    40: { level: 40, freeReward: find('banner_grid'), premiumReward: find('outfit_storm_chaser') },
    42: { level: 42, premiumReward: find('glider_storm') },
    44: { level: 44, freeReward: find('emote_salute'), premiumReward: find('pickaxe_reaper') },
    46: { level: 46, premiumReward: find('banner_eye') },
    47: { level: 47, freeReward: find('wrap_camo'), premiumReward: find('loading_skyline') },
    48: { level: 48, premiumReward: find('backpack_core') },
    49: { level: 49, freeReward: 'credits:500', premiumReward: find('banner_crown') },
    50: { level: 50, freeReward: 'xpboost:10', premiumReward: find('outfit_frontier_marshal') },
  };
  const out: BattlePassReward[] = [];
  for (let l = 1; l <= BP_TIERS; l++) {
    if (fixed[l]) out.push(fixed[l]);
    else if (l % 2 === 0) out.push({ level: l, freeReward: l % 4 === 0 ? 'xpboost:2' : undefined, premiumReward: `credits:${l < 25 ? 100 : 150}` });
    else out.push({ level: l, premiumReward: l % 3 === 0 ? 'xpboost:3' : 'credits:100' });
  }
  return out;
}

export const SEASON_1: SeasonConfig = {
  id: 's01',
  name: 'FALLEN FRONTIER',
  number: 1,
  theme: 'The storm broke containment. The frontier is ours to take back.',
  startDate: '2026-09-01',
  endDate: '2026-12-01',
  battlePass: buildRewards(),
  premiumPrice: 950,
  shopPool: COSMETICS.filter((c) => c.source === 'shop' && c.price > 0).map((c) => c.id),
  mapChanges: ['Hollow Ridge opens with six named locations', 'Skyline Labs containment tower is unstable'],
};

export const CURRENT_SEASON = SEASON_1;

export function rewardLabel(reward: string): string {
  if (reward.startsWith('credits:')) return `${reward.split(':')[1]} Credits`;
  if (reward.startsWith('xpboost:')) return `+${reward.split(':')[1]}% Match XP`;
  return COSMETICS.find((c) => c.id === reward)?.name ?? reward;
}
