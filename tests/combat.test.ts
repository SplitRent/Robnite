import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { TILE, TILE_H } from '../src/core/constants';
import { Match } from '../src/game/Match';
import { MODES } from '../src/game/modes';
import { WEAPONS, weaponStats } from '../src/weapons/weapons';
import { makeTarget } from '../src/building/targeting';
import type { CosmeticLoadout } from '../src/player/Combatant';
import type { ModeConfig } from '../src/game/matchTypes';

const cos = (): CosmeticLoadout => ({ outfit: 'default', backpack: 'none', pickaxe: 'default', glider: 'default', wrap: 'none', emote: 'wave' });

/** A duel with the bot frozen in place so shots are deterministic. */
function setup(overrides: Partial<ModeConfig> = {}) {
  const m = new Match({ mode: { ...MODES.duel, ...overrides }, difficulty: 'easy', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 11 });
  m.brains.length = 0; // disable bot AI
  for (let i = 0; i < 60 * 3.2; i++) m.step(1 / 60); // warmup → active
  const h = m.human;
  const bot = m.combatants[1];
  h.pos.set(-24, m.world.collision.terrainHeight(-24, 0), 0);
  bot.pos.set(-24, m.world.collision.terrainHeight(-24, -10), -10);
  h.vel.set(0, 0, 0);
  bot.vel.set(0, 0, 0);
  return { m, h, bot };
}

/** Point the human's aim ray at a world position (straight from the eye). */
function aimAt(m: Match, target: Vector3) {
  const h = m.human;
  const eye = h.eye(new Vector3());
  const dir = target.clone().sub(eye).normalize();
  h.input.rayOrigin = { x: eye.x, y: eye.y, z: eye.z };
  h.input.rayDir = { x: dir.x, y: dir.y, z: dir.z };
  h.input.yaw = Math.atan2(-dir.x, -dir.z);
  h.input.pitch = Math.asin(dir.y);
  h.input.aim = true;
}

function fireOnce(m: Match) {
  m.human.input.fire = true;
  m.step(1 / 60);
  m.human.input.fire = false;
  m.step(1 / 60);
}

describe('combat', () => {
  it('marksman body shot damages shield first, then health', () => {
    const { m, h, bot } = setup();
    h.inventory.selected = 1; // rifle
    aimAt(m, bot.chest(new Vector3()));
    const before = bot.shield;
    fireOnce(m);
    const dmg = Math.round(weaponStats('ar', 'elite').damage);
    expect(before).toBe(100);
    expect(bot.shield).toBe(100 - dmg);
    expect(bot.health).toBe(100);
  });

  it('headshots apply the head multiplier', () => {
    const { m, h, bot } = setup();
    h.inventory.selected = 3;
    const head = new Vector3(bot.pos.x, bot.pos.y + bot.height - 0.2, bot.pos.z);
    aimAt(m, head);
    let headshot = false;
    m.events.on('PLAYER_DAMAGE', (e) => (headshot = e.headshot));
    fireOnce(m);
    expect(headshot).toBe(true);
    const expected = Math.round(weaponStats('marksman', 'elite').damage * WEAPONS.marksman.headMult);
    expect(200 - (bot.shield + bot.health)).toBe(expected);
  });

  it('eliminates a target at zero health', () => {
    const { m, h, bot } = setup();
    h.inventory.selected = 3;
    bot.shield = 0;
    bot.health = 30;
    aimAt(m, bot.chest(new Vector3()));
    let elim = false;
    m.events.on('PLAYER_ELIMINATED', (e) => (elim = e.victimId === bot.id && e.killerId === h.id));
    fireOnce(m);
    expect(bot.alive).toBe(false);
    expect(elim).toBe(true);
    expect(h.stats.eliminations).toBe(1);
  });

  it('ammo decreases, reload refills the magazine', () => {
    const { m, h, bot } = setup();
    h.inventory.selected = 1; // rifle
    aimAt(m, bot.chest(new Vector3()).add(new Vector3(5, 0, 0)));
    const w = h.inventory.currentWeapon()!;
    fireOnce(m);
    expect(w.ammoInMag).toBe(WEAPONS.ar.magSize - 1);
    m.queueAction(h.id, { type: 'reload' });
    for (let i = 0; i < 60 * 3; i++) m.step(1 / 60);
    expect(w.ammoInMag).toBe(WEAPONS.ar.magSize);
  });

  it('finite ammo reserves are consumed by reloads', () => {
    const { m, h } = setup({ unlimitedAmmo: false });
    h.inventory.unlimitedAmmo = false;
    h.inventory.selected = 1;
    h.inventory.ammo.medium = 10;
    const w = h.inventory.currentWeapon()!;
    w.ammoInMag = 0;
    m.queueAction(h.id, { type: 'reload' });
    for (let i = 0; i < 60 * 3; i++) m.step(1 / 60);
    expect(w.ammoInMag).toBe(10);
    expect(h.inventory.ammo.medium).toBe(0);
  });

  it('weapon switching is immediate', () => {
    const { m, h } = setup();
    m.queueAction(h.id, { type: 'selectSlot', slot: 2 });
    m.step(1 / 60);
    expect(h.inventory.selected).toBe(2);
    m.queueAction(h.id, { type: 'selectPickaxe' });
    m.step(1 / 60);
    expect(h.inventory.selected).toBe('pickaxe');
  });

  it('shield cells heal shield after the use time and are consumed', () => {
    const { m, h } = setup();
    h.shield = 0;
    h.inventory.selected = 4;
    fireOnce(m);
    for (let i = 0; i < 60 * 2.2; i++) m.step(1 / 60);
    expect(h.shield).toBe(25);
    const item = h.inventory.slots[4];
    expect(item && item.kind === 'consumable' ? item.count : 0).toBe(5);
  });

  it('walls block bullets and take structure damage', () => {
    const { m, h, bot } = setup();
    h.inventory.selected = 3;
    const gy = Math.floor((h.pos.y + 0.3) / TILE_H);
    const t = [gy, gy - 1, gy + 1].map((y) => makeTarget('wall', { x: -7, y, z: -1 }, 1)).find((c) => m.builds.validate(c, null).valid)!;
    expect(t).toBeDefined();
    const wall = m.builds.place(t, null, { ownerId: 99 });
    expect(wall).not.toBeNull();
    // Wall spans cell x = -7 on the line z = -TILE; aim at the bot behind it.
    bot.pos.x = -6.5 * TILE;
    h.pos.x = -6.5 * TILE;
    aimAt(m, bot.chest(new Vector3()));
    // Stack a second wall so the shot line (from a higher eye) is fully covered.
    m.builds.place(makeTarget('wall', { x: -7, y: t.grid.y + 1, z: -1 }, 1), null, { ownerId: 99 });
    let structureHit = 0;
    m.events.on('BUILD_DAMAGED', (e) => (structureHit += e.amount));
    fireOnce(m);
    expect(bot.shield).toBe(100);
    expect(structureHit).toBeGreaterThan(0);
  });

  it('storm damage bypasses shields', () => {
    const m = new Match({ mode: MODES.zonewar, difficulty: 'easy', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 4 });
    m.brains.length = 0;
    for (let i = 0; i < 60 * 3.2; i++) m.step(1 / 60);
    const h = m.human;
    m.storm!.radius = 10;
    h.pos.set(m.storm!.centerX + 30, 0, m.storm!.centerZ);
    h.pos.y = m.world.collision.terrainHeight(h.pos.x, h.pos.z);
    const shield = h.shield;
    for (let i = 0; i < 60 * 1.2; i++) m.step(1 / 60);
    expect(h.shield).toBe(shield);
    expect(h.health).toBeLessThan(100);
  });

  it('pickaxe harvests resources into materials', () => {
    const m = new Match({ mode: MODES.br, difficulty: 'easy', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 4 });
    m.brains.length = 0;
    const h = m.human;
    const tree = m.world.resources.find((r) => r.spec.kind === 'pine')!;
    h.air = 'none';
    h.pos.set(tree.spec.x + 1.6, tree.spec.y, tree.spec.z);
    m.phase = 'ACTIVE';
    const eye = h.eye(new Vector3());
    const dir = new Vector3(tree.spec.x, eye.y, tree.spec.z).sub(eye).normalize();
    h.input.rayOrigin = { x: eye.x, y: eye.y, z: eye.z };
    h.input.rayDir = { x: dir.x, y: dir.y, z: dir.z };
    h.inventory.selected = 'pickaxe';
    fireOnce(m);
    expect(h.materials.wood).toBeGreaterThan(0);
  });
});

describe('bots', () => {
  it('bots move, build, heal and shoot during a battle royale', () => {
    const m = new Match({ mode: MODES.br, difficulty: 'hard', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 21 });
    const seen = { shots: 0, builds: 0, loot: 0 };
    m.events.on('SHOT_FIRED', (e) => { if (e.shooterId !== 0) seen.shots++; });
    m.events.on('BUILD_PLACED', (e) => { if (e.piece.ownerId !== 0) seen.builds++; });
    m.events.on('ITEM_PICKED_UP', (e) => { if (e.combatantId !== 0) seen.loot++; });
    for (let i = 0; i < 60 * 200 && !m.result; i++) m.step(1 / 60);
    expect(seen.loot).toBeGreaterThan(5);
    expect(seen.shots).toBeGreaterThan(10);
    expect(m.combatants.some((c) => !c.alive)).toBe(true);
  }, 60000);

  it('bots do not see through walls', () => {
    const m = new Match({ mode: MODES.duel, difficulty: 'elite', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 5 });
    const brain = m.brains[0];
    const bot = brain.self;
    const h = m.human;
    const x = -6 * TILE;
    h.pos.set(x, m.world.collision.terrainHeight(x, 0), 0);
    bot.pos.set(x, m.world.collision.terrainHeight(x, -10), -10);
    const canSee = (brain as unknown as { canSee(o: typeof h): boolean }).canSee.bind(brain);
    bot.yaw = Math.PI; // facing +Z toward the human
    expect(canSee(h)).toBe(true);
    const gy = Math.floor((h.pos.y + 0.3) / TILE_H);
    for (const x of [-7, -6]) for (let y = gy - 1; y < gy + 2; y++) m.builds.place(makeTarget('wall', { x, y, z: -1 }, 1), null, { ownerId: 99 });
    expect(canSee(h)).toBe(false);
  });
});
