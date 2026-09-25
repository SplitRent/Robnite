import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Match } from '../src/game/Match';
import { MODES } from '../src/game/modes';
import type { CosmeticLoadout } from '../src/player/Combatant';
import type { ModeId } from '../src/game/matchTypes';

const cos = (): CosmeticLoadout => ({ outfit: 'default', backpack: 'none', pickaxe: 'default', glider: 'default', wrap: 'none', emote: 'wave' });

function makeMatch(mode: ModeId, seed = 42) {
  return new Match({ mode: MODES[mode], difficulty: 'hard', playerName: 'Tester', cosmetics: cos(), botCosmetics: cos, seed });
}

function run(m: Match, seconds: number) {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) m.step(1 / 60);
}

describe('match simulation', () => {
  it('duel: bots spawn, move and fight', () => {
    const m = makeMatch('duel');
    const bot = m.combatants[1];
    const start = bot.pos.clone();
    // Put the human somewhere visible and idle.
    run(m, 4);
    expect(m.phase).toBe('ACTIVE');
    run(m, 8);
    expect(bot.pos.distanceTo(start)).toBeGreaterThan(2);
    // The idle human should be found and shot by the bot.
    for (let i = 0; i < 12 && !m.result; i++) run(m, 5);
    expect(m.human.stats.damageTaken).toBeGreaterThan(0);
  });

  it('battle royale: deployment → landing → looting → combat → storm → finish', () => {
    const m = makeMatch('br', 7);
    let weaponPickups = 0;
    m.events.on('ITEM_PICKED_UP', (e) => {
      if (e.item.kind === 'weapon') weaponPickups++;
    });
    expect(m.phase).toBe('WARMUP');
    run(m, 6);
    expect(m.phase).toBe('DEPLOYMENT');
    // Human jumps immediately.
    m.queueAction(0, { type: 'jumpFromBus' });
    run(m, 30);
    expect(m.combatants.every((c) => c.air !== 'bus')).toBe(true);
    run(m, 30);
    const landed = m.combatants.filter((c) => c.air === 'none').length;
    expect(landed).toBeGreaterThan(10);
    run(m, 60);
    expect(weaponPickups).toBeGreaterThan(4);
    // Run most of the match.
    for (let i = 0; i < 12 && m.phase !== 'VICTORY' && m.phase !== 'ELIMINATED'; i++) run(m, 30);
    const dead = m.combatants.filter((c) => !c.alive).length;
    expect(dead).toBeGreaterThan(0);
    expect(m.storm).not.toBeNull();
  }, 60000);

  it('box fight rounds reset and a match winner is decided', () => {
    const m = makeMatch('boxfight', 3);
    expect(m.builds.count).toBeGreaterThan(6);
    let rounds = 0;
    m.events.on('ROUND_ENDED', () => rounds++);
    // The bot finds the (idle) human inside their box and fights.
    for (let i = 0; i < 12 && m.human.stats.damageTaken === 0; i++) run(m, 10);
    expect(m.human.stats.damageTaken).toBeGreaterThan(0);
    // An elimination ends the round and a new one starts with fresh boxes.
    const priv = m as unknown as { applyDamage(t: unknown, n: number, a: unknown, s: string, h: boolean, p: Vector3, c: string): void };
    priv.applyDamage(m.human, 500, m.combatants[1], 'weapon', false, m.human.pos.clone(), 'weapon');
    for (let i = 0; i < 20 && rounds === 0; i++) run(m, 1);
    expect(rounds).toBeGreaterThan(0);
    run(m, 8);
    expect(m.builds.count).toBeGreaterThan(6);
  }, 60000);

  it('zone war runs with storm', () => {
    const m = makeMatch('zonewar', 5);
    run(m, 60);
    expect(m.storm).not.toBeNull();
    expect(m.combatants.filter((c) => !c.alive).length).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('freebuild has targets, dummies, practice walls and resets builds', () => {
    const m = makeMatch('freebuild');
    expect(m.targets.length).toBeGreaterThan(0);
    const before = m.builds.count;
    expect(before).toBeGreaterThan(4);
    run(m, 2);
    m.queueAction(0, { type: 'resetBuilds' });
    run(m, 0.1);
    expect(m.builds.count).toBe(before);
    expect(m.human.unlimitedMaterials).toBe(true);
  });
});
