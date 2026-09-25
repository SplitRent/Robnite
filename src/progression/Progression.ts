import { EventBus } from '../core/events';
import { dayIndex, weekIndex } from '../core/rng';
import { COSMETIC_BY_ID, type CosmeticCategory } from '../cosmetics/catalog';
import { BP_TIERS, BP_XP_PER_TIER, CURRENT_SEASON, rewardLabel } from '../season/season';
import { QUEST_BY_ID, addQuestProgress, refreshQuests, type Quest, type QuestType } from '../quests/quests';
import type { SaveManager } from '../save/SaveManager';
import type { MatchRecord } from '../save/schema';
import type { MatchResult } from '../game/matchTypes';

export interface ProgressionEvents {
  XP_GAINED: { amount: number; reason: string };
  LEVEL_UP: { level: number };
  BP_TIER: { tier: number };
  QUEST_COMPLETE: { quest: Quest };
  CURRENCY: { delta: number; reason: string };
  REWARD: { label: string };
}

export interface XPLine {
  label: string;
  xp: number;
}

export interface MatchSummary {
  lines: XPLine[];
  totalXP: number;
  credits: number;
  levelBefore: number;
  levelAfter: number;
  xpBefore: number;
  xpAfter: number;
  bpBefore: number;
  bpAfter: number;
  quests: Quest[];
}

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return 1500 + 250 * level;
}

const NAME_BLOCKLIST = ['admin', 'moderator', 'fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'hitler', 'nazi'];

export function validateDisplayName(raw: string): { ok: boolean; name: string; reason?: string } {
  const name = raw.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return { ok: false, name, reason: 'Name contains invalid characters' };
  if (name.length < 3) return { ok: false, name, reason: 'Name must be at least 3 characters' };
  if (name.length > 16) return { ok: false, name, reason: 'Name must be 16 characters or fewer' };
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(name)) return { ok: false, name, reason: 'Use letters, numbers, spaces, _ . or -' };
  const lower = name.toLowerCase().replace(/[^a-z]/g, '');
  if (NAME_BLOCKLIST.some((w) => lower.includes(w))) return { ok: false, name, reason: 'Please choose a different name' };
  return { ok: true, name };
}

const CODES: Record<string, { label: string; apply: (p: Progression) => void }> = {
  ROBNITE: { label: '+500 Credits', apply: (p) => p.addCurrency(500, 'Code redeemed') },
  FOUNDER: { label: 'Founder Outfit', apply: (p) => p.grantItem('outfit_founder') },
  GRIDSTEP: { label: 'Grid Step Emote', apply: (p) => p.grantItem('emote_dance') },
  HOLLOWRIDGE: { label: '+2,000 XP', apply: (p) => p.awardXP(2000, 'Code redeemed') },
};

/** All profile progression rules (XP, levels, battle pass, quests, currency). */
export class Progression {
  readonly events = new EventBus<ProgressionEvents>();

  constructor(private save: SaveManager) {
    this.refreshQuests();
  }

  get d() {
    return this.save.data;
  }

  refreshQuests(): void {
    if (refreshQuests(this.d.quests, dayIndex(), weekIndex())) this.save.save();
  }

  addCurrency(delta: number, reason: string): void {
    this.d.profile.currency = Math.max(0, this.d.profile.currency + delta);
    this.events.emit('CURRENCY', { delta, reason });
    this.save.save();
  }

  grantItem(id: string): boolean {
    if (!COSMETIC_BY_ID.has(id) || this.d.profile.inventory.includes(id)) return false;
    this.d.profile.inventory.push(id);
    this.events.emit('REWARD', { label: COSMETIC_BY_ID.get(id)!.name });
    this.save.save();
    return true;
  }

  /** Award XP to the account level and the battle pass. */
  awardXP(amount: number, reason: string, persist = true): void {
    if (amount <= 0) return;
    const p = this.d.profile;
    p.xp += amount;
    p.totalXp += amount;
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      p.level++;
      this.events.emit('LEVEL_UP', { level: p.level });
    }
    const bp = this.d.battlePass;
    bp.xp += amount;
    while (bp.xp >= BP_XP_PER_TIER && bp.level < BP_TIERS) {
      bp.xp -= BP_XP_PER_TIER;
      bp.level++;
      this.events.emit('BP_TIER', { tier: bp.level });
    }
    if (bp.level >= BP_TIERS) bp.xp = Math.min(bp.xp, BP_XP_PER_TIER);
    this.events.emit('XP_GAINED', { amount, reason });
    if (persist) this.save.save();
  }

  /** Live quest progress (called during matches). */
  questProgress(type: QuestType, amount: number): Quest[] {
    if (amount <= 0) return [];
    this.refreshQuests();
    const done = addQuestProgress(this.d.quests, type, amount);
    for (const q of done) {
      this.events.emit('QUEST_COMPLETE', { quest: q });
      this.awardXP(q.rewardXP, `Quest: ${q.title}`, false);
    }
    this.save.saveSoon();
    return done;
  }

  matchXP(r: MatchResult): XPLine[] {
    const lines: XPLine[] = [];
    const training = r.mode === 'freebuild' || r.mode === 'tutorial';
    if (training) return lines;
    lines.push({ label: 'Match played', xp: 200 });
    const minutes = Math.floor(r.survivalTime / 60);
    if (minutes > 0) lines.push({ label: `Survival (${minutes} min)`, xp: minutes * 60 });
    if (r.eliminations) lines.push({ label: `Eliminations x${r.eliminations}`, xp: r.eliminations * 250 });
    if (r.damage > 0) lines.push({ label: `Damage dealt (${r.damage})`, xp: Math.round(r.damage / 4) });
    if (r.chestsOpened) lines.push({ label: `Containers opened x${r.chestsOpened}`, xp: r.chestsOpened * 40 });
    if (r.materialsGathered) lines.push({ label: 'Resources collected', xp: Math.min(400, Math.round(r.materialsGathered / 5)) });
    if (r.poisVisited.length && r.mode === 'br') lines.push({ label: `Locations explored x${r.poisVisited.length}`, xp: r.poisVisited.length * 60 });
    if (r.mode === 'br' && !r.won) {
      const top = r.placement <= 3 ? 400 : r.placement <= 8 ? 150 : 0;
      if (top) lines.push({ label: `Top ${r.placement <= 3 ? 3 : 8} placement`, xp: top });
    }
    if (r.won) lines.push({ label: r.mode === 'br' ? 'Victory — last one standing' : 'Match won', xp: r.mode === 'br' ? 1500 : 600 });
    if (r.roundsWon) lines.push({ label: `Rounds won x${r.roundsWon}`, xp: r.roundsWon * 120 });
    const boost = this.d.battlePass.xpBoost;
    if (boost > 0) {
      const base = lines.reduce((a, l) => a + l.xp, 0);
      lines.push({ label: `Battle Pass boost (+${boost}%)`, xp: Math.round((base * boost) / 100) });
    }
    return lines;
  }

  matchCredits(r: MatchResult): number {
    if (r.mode === 'freebuild' || r.mode === 'tutorial') return 0;
    return 20 + r.eliminations * 10 + (r.won ? (r.mode === 'br' ? 150 : 50) : 0);
  }

  /** Record a finished match: stats, history, quests, XP and credits. */
  recordMatch(r: MatchResult): MatchSummary {
    const d = this.d;
    const levelBefore = d.profile.level;
    const xpBefore = d.profile.xp;
    const bpBefore = d.battlePass.level;
    const training = r.mode === 'freebuild' || r.mode === 'tutorial';
    const s = d.stats;
    s.playTime += r.survivalTime;
    if (!training) {
      s.matches++;
      if (r.won) s.wins++;
      else s.deaths++;
      s.eliminations += r.eliminations;
      s.damage += r.damage;
      s.headshots += r.headshots;
      s.chestsOpened += r.chestsOpened;
      s.materialsGathered += r.materialsGathered;
      s.modeCounts[r.mode] = (s.modeCounts[r.mode] ?? 0) + 1;
      if (r.mode === 'br' && (s.bestPlacement === 0 || r.placement < s.bestPlacement)) s.bestPlacement = r.placement;
    }
    s.buildsPlaced += r.builds;
    s.edits += r.edits;
    const quests: Quest[] = [];
    if (!training) {
      quests.push(...addQuestProgress(d.quests, 'matches', 1));
      if (r.won) quests.push(...addQuestProgress(d.quests, 'wins', 1));
      quests.push(...addQuestProgress(d.quests, 'survive', Math.round(r.survivalTime)));
    }
    for (const q of quests) {
      this.events.emit('QUEST_COMPLETE', { quest: q });
      this.awardXP(q.rewardXP, `Quest: ${q.title}`, false);
    }
    const lines = this.matchXP(r);
    const totalXP = lines.reduce((a, l) => a + l.xp, 0);
    this.awardXP(totalXP, 'Match', false);
    const credits = this.matchCredits(r);
    if (credits) {
      d.profile.currency += credits;
      this.events.emit('CURRENCY', { delta: credits, reason: 'Match reward' });
    }
    const record: MatchRecord = { ...r, xp: totalXP, credits };
    d.matchHistory.unshift(record);
    d.matchHistory = d.matchHistory.slice(0, 30);
    this.save.save();
    return { lines, totalXP, credits, levelBefore, levelAfter: d.profile.level, xpBefore, xpAfter: d.profile.xp, bpBefore, bpAfter: d.battlePass.level, quests };
  }

  // ------------------------------------------------------------ battle pass

  rewardState(level: number, track: 'free' | 'premium'): 'locked' | 'claimable' | 'claimed' | 'empty' | 'premium-locked' {
    const r = CURRENT_SEASON.battlePass[level - 1];
    const reward = track === 'free' ? r?.freeReward : r?.premiumReward;
    if (!reward) return 'empty';
    const bp = this.d.battlePass;
    const claimed = (track === 'free' ? bp.claimedFree : bp.claimedPremium).includes(level);
    if (claimed) return 'claimed';
    if (bp.level < level) return 'locked';
    if (track === 'premium' && !bp.premium) return 'premium-locked';
    return 'claimable';
  }

  claimReward(level: number, track: 'free' | 'premium'): string | null {
    if (this.rewardState(level, track) !== 'claimable') return null;
    const r = CURRENT_SEASON.battlePass[level - 1];
    const reward = (track === 'free' ? r.freeReward : r.premiumReward)!;
    const bp = this.d.battlePass;
    (track === 'free' ? bp.claimedFree : bp.claimedPremium).push(level);
    if (reward.startsWith('credits:')) {
      this.d.profile.currency += Number(reward.split(':')[1]);
      this.events.emit('CURRENCY', { delta: Number(reward.split(':')[1]), reason: 'Battle Pass' });
    } else if (reward.startsWith('xpboost:')) {
      bp.xpBoost += Number(reward.split(':')[1]);
    } else if (!this.d.profile.inventory.includes(reward)) {
      this.d.profile.inventory.push(reward);
    }
    this.events.emit('REWARD', { label: rewardLabel(reward) });
    this.save.save();
    return reward;
  }

  claimableCount(): number {
    let n = 0;
    for (let l = 1; l <= BP_TIERS; l++) {
      if (this.rewardState(l, 'free') === 'claimable') n++;
      if (this.rewardState(l, 'premium') === 'claimable') n++;
    }
    return n;
  }

  /** Unlock the cosmetic premium track with fictional Credits. */
  buyPremium(): { ok: boolean; reason?: string } {
    const bp = this.d.battlePass;
    if (bp.premium) return { ok: false, reason: 'Already unlocked' };
    if (this.d.profile.currency < CURRENT_SEASON.premiumPrice) return { ok: false, reason: 'Not enough Credits' };
    this.d.profile.currency -= CURRENT_SEASON.premiumPrice;
    bp.premium = true;
    this.save.save();
    return { ok: true };
  }

  // ------------------------------------------------------------ locker / profile

  equip(category: CosmeticCategory, id: string): boolean {
    const item = COSMETIC_BY_ID.get(id);
    if (!item || item.category !== category || !this.d.profile.inventory.includes(id)) return false;
    this.d.profile.equipped[category] = id;
    this.save.save();
    return true;
  }

  setDisplayName(raw: string): { ok: boolean; reason?: string } {
    const v = validateDisplayName(raw);
    if (!v.ok) return v;
    this.d.profile.displayName = v.name;
    this.save.save();
    return { ok: true };
  }

  /** Daily login bonus. Returns null if already claimed today. */
  dailyLogin(today = dayIndex()): { day: number; streak: number; credits: number } | null {
    const l = this.d.login;
    if (l.lastDay === today) return null;
    l.streak = l.lastDay === today - 1 ? l.streak + 1 : 1;
    l.lastDay = today;
    const credits = 100 + Math.min(6, l.streak - 1) * 25;
    this.d.profile.currency += credits;
    this.save.save();
    return { day: today, streak: l.streak, credits };
  }

  redeem(raw: string): { ok: boolean; message: string } {
    const code = raw.trim().toUpperCase();
    const entry = CODES[code];
    if (!entry) return { ok: false, message: 'That code is not valid.' };
    if (this.d.redeemed.includes(code)) return { ok: false, message: 'Code already redeemed.' };
    this.d.redeemed.push(code);
    entry.apply(this);
    this.save.save();
    return { ok: true, message: `Redeemed: ${entry.label}` };
  }

  favoriteMode(): string {
    const counts = this.d.stats.modeCounts;
    let best = '';
    let n = 0;
    for (const [k, v] of Object.entries(counts)) if ((v ?? 0) > n) {
      n = v ?? 0;
      best = k;
    }
    return best;
  }

  questDef(id: string): Quest | undefined {
    return QUEST_BY_ID.get(id);
  }
}
