import { it } from 'vitest';
import { Match } from '../../src/game/Match';
import { MODES } from '../../src/game/modes';
const cos = () => ({ outfit: 'default', backpack: 'none', pickaxe: 'default', glider: 'default', wrap: 'none', emote: 'wave' });
it('debug', () => {
  for (const seed of [7, 8, 9]) {
  const m = new Match({ mode: MODES.br, difficulty: 'normal', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed });
  const elim: Record<string, number> = {};
  let picks = 0, builds = 0, heals = 0;
  m.events.on('PLAYER_ELIMINATED', (e) => { elim[e.weapon] = (elim[e.weapon] ?? 0) + 1; if (e.weapon==='pickaxe' && seed===7) { const k=m.byId(e.killerId)!; const v=m.byId(e.victimId)!; console.log('PX', m.time.toFixed(0), k.name, 'kW', k.inventory.weapons().length, (m.brains.find(b=>b.self===k) as any)?.state, 'victim', v.name, 'vW', v.inventory.weapons().length, (m.brains.find(b=>b.self===v) as any)?.state, 'dmgTaken', v.stats.damageTaken); } });
  m.events.on('ITEM_PICKED_UP', (e) => { if (e.item.kind === 'weapon') picks++; });
  m.events.on('BUILD_PLACED', () => builds++);
  m.events.on('ITEM_USED', () => heals++);
  const run = (s: number) => { for (let i = 0; i < s * 60; i++) m.step(1 / 60); };
  run(6); m.queueAction(0, { type: 'jumpFromBus' });
  const t0 = performance.now();
  let k = 0;
  while (k++ < 50 && m.aliveCount > 1) run(10);
  console.log('seed', seed, 'simTime', m.time.toFixed(0), 'wall ms', (performance.now() - t0).toFixed(0), 'alive', m.aliveCount, 'elims', JSON.stringify(elim), 'weaponPicks', picks, 'builds', builds, 'heals', heals, 'storm phase', m.storm?.phase);
  }
});
