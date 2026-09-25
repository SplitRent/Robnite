import { describe, expect, it } from 'vitest';
import { SafeStorage } from '../src/save/storage';
import { SaveManager } from '../src/save/SaveManager';
import { SAVE_KEY, defaultSave } from '../src/save/schema';
import { Progression, validateDisplayName, xpForLevel } from '../src/progression/Progression';
import { LocalShopService, shopRotation } from '../src/cosmetics/shop';
import { BP_XP_PER_TIER } from '../src/season/season';
import { findConflicts, DEFAULT_BINDINGS } from '../src/input/bindings';
import type { MatchResult } from '../src/game/matchTypes';

class MemStorage implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

function fresh(storage = new MemStorage()) {
  const save = new SaveManager(new SafeStorage(storage));
  return { save, storage, prog: new Progression(save) };
}

const result = (over: Partial<MatchResult> = {}): MatchResult => ({
  mode: 'br', modeName: 'Battle Royale', won: false, placement: 5, totalPlayers: 16, eliminations: 2, damage: 800, damageTaken: 200,
  headshots: 1, survivalTime: 300, builds: 40, edits: 10, materialsGathered: 300, materialsUsed: 200, chestsOpened: 3,
  poisVisited: ['ridgeway'], roundsWon: 0, roundsLost: 0, timestamp: Date.now(), ...over,
});

describe('save system', () => {
  it('persists and reloads changes', () => {
    const { save, storage, prog } = fresh();
    prog.setDisplayName('Tester');
    save.data.settings.mouse.sensX = 1.7;
    save.data.keybinds.wall = ['KeyQ'];
    save.save();
    const again = new SaveManager(new SafeStorage(storage));
    expect(again.data.profile.displayName).toBe('Tester');
    expect(again.data.settings.mouse.sensX).toBe(1.7);
    expect(again.data.keybinds.wall).toEqual(['KeyQ']);
  });

  it('fills in missing fields without discarding the rest', () => {
    const storage = new MemStorage();
    const d = defaultSave() as unknown as Record<string, unknown>;
    (d.profile as Record<string, unknown>).displayName = 'Keeper';
    delete d.settings;
    delete (d.stats as Record<string, unknown>).wins;
    storage.setItem(SAVE_KEY, JSON.stringify(d));
    const s = new SaveManager(new SafeStorage(storage));
    expect(s.data.profile.displayName).toBe('Keeper');
    expect(s.data.settings.video.fov).toBe(80);
    expect(s.data.stats.wins).toBe(0);
  });

  it('survives corrupt JSON and keeps a backup', () => {
    const storage = new MemStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const s = new SaveManager(new SafeStorage(storage));
    expect(s.data.profile.level).toBe(1);
    expect(s.lastError).toBeTruthy();
    expect([...storage.m.keys()].some((k) => k.includes('corrupt'))).toBe(true);
  });

  it('migrates a v0 save', () => {
    const storage = new MemStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ displayName: 'OldTimer' }));
    const s = new SaveManager(new SafeStorage(storage));
    expect(s.data.profile.displayName).toBe('OldTimer');
    expect(s.data.version).toBe(1);
  });

  it('repairs equipped items that are not owned', () => {
    const storage = new MemStorage();
    const d = defaultSave();
    d.profile.equipped.outfit = 'outfit_solar_flare';
    storage.setItem(SAVE_KEY, JSON.stringify(d));
    const s = new SaveManager(new SafeStorage(storage));
    expect(s.data.profile.equipped.outfit).toBe('outfit_recruit');
  });

  it('works when storage is unavailable', () => {
    const s = new SaveManager(new SafeStorage(null));
    expect(s.persistent).toBe(false);
    expect(s.save()).toBe(false);
  });
});

describe('progression', () => {
  it('levels up across thresholds', () => {
    const { prog, save } = fresh();
    const need = xpForLevel(1);
    prog.awardXP(need + 10, 'test');
    expect(save.data.profile.level).toBe(2);
    expect(save.data.profile.xp).toBe(10);
  });

  it('records a match: stats, history, xp and credits', () => {
    const { prog, save } = fresh();
    const credits = save.data.profile.currency;
    const summary = prog.recordMatch(result({ won: true, placement: 1 }));
    expect(summary.totalXP).toBeGreaterThan(1500);
    expect(save.data.stats.wins).toBe(1);
    expect(save.data.matchHistory.length).toBe(1);
    expect(save.data.profile.currency).toBeGreaterThan(credits);
  });

  it('quests progress and grant XP on completion', () => {
    const { prog, save } = fresh();
    const q = save.data.quests.daily[0];
    const def = prog.questDef(q.id)!;
    const before = save.data.profile.totalXp;
    const done = prog.questProgress(def.type, def.goal);
    expect(done.map((x) => x.id)).toContain(def.id);
    expect(save.data.profile.totalXp).toBe(before + def.rewardXP);
  });

  it('battle pass reward becomes claimable and goes to the locker', () => {
    const { prog, save } = fresh();
    expect(prog.rewardState(5, 'free')).toBe('locked');
    prog.awardXP(BP_XP_PER_TIER * 4, 'test');
    expect(save.data.battlePass.level).toBe(5);
    expect(prog.rewardState(5, 'free')).toBe('claimable');
    const reward = prog.claimReward(5, 'free');
    expect(reward).toBe('banner_picks');
    expect(save.data.profile.inventory).toContain('banner_picks');
    expect(prog.equip('banner', 'banner_picks')).toBe(true);
    expect(prog.rewardState(5, 'premium')).toBe('premium-locked');
  });

  it('shop purchase spends credits and adds to inventory', async () => {
    const { save } = fresh();
    save.data.profile.currency = 5000;
    const shop = new LocalShopService(save);
    const item = shopRotation().sections.daily[0];
    const r = await shop.purchase(item.id);
    expect(r.ok).toBe(true);
    expect(save.data.profile.currency).toBe(5000 - item.price);
    expect(save.data.profile.inventory).toContain(item.id);
    expect((await shop.purchase(item.id)).ok).toBe(false);
  });

  it('shop rotation is deterministic per day', () => {
    const a = shopRotation(new Date(2026, 8, 25));
    const b = shopRotation(new Date(2026, 8, 25, 18));
    const c = shopRotation(new Date(2026, 8, 26));
    expect(a.sections.daily.map((x) => x.id)).toEqual(b.sections.daily.map((x) => x.id));
    expect(a.sections.daily.map((x) => x.id)).not.toEqual(c.sections.daily.map((x) => x.id));
  });

  it('validates display names', () => {
    expect(validateDisplayName('ab').ok).toBe(false);
    expect(validateDisplayName('a'.repeat(17)).ok).toBe(false);
    expect(validateDisplayName('Good Name').ok).toBe(true);
    expect(validateDisplayName('bad\u0007name').ok).toBe(false);
  });

  it('redeem codes work once', () => {
    const { prog, save } = fresh();
    expect(prog.redeem('founder').ok).toBe(true);
    expect(save.data.profile.inventory).toContain('outfit_founder');
    expect(prog.redeem('FOUNDER').ok).toBe(false);
    expect(prog.redeem('nope').ok).toBe(false);
  });

  it('daily login pays once per day and tracks streaks', () => {
    const { prog } = fresh();
    expect(prog.dailyLogin(100)?.streak).toBe(1);
    expect(prog.dailyLogin(100)).toBeNull();
    expect(prog.dailyLogin(101)?.streak).toBe(2);
    expect(prog.dailyLogin(105)?.streak).toBe(1);
  });
});

describe('keybinds', () => {
  it('detects conflicts but allows contextual pairs', () => {
    expect(findConflicts(DEFAULT_BINDINGS, 'ramp', 'KeyZ')).toEqual(['wall']);
    expect(findConflicts(DEFAULT_BINDINGS, 'rotate', 'KeyR')).toEqual([]);
    expect(findConflicts(DEFAULT_BINDINGS, 'interact', 'KeyE')).toEqual([]);
  });
});
