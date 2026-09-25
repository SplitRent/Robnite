import { it } from 'vitest';
import { Match } from '../../src/game/Match';
import { MODES } from '../../src/game/modes';
const cos = () => ({ outfit: 'default', backpack: 'none', pickaxe: 'default', glider: 'default', wrap: 'none', emote: 'wave' });
for (const mode of ['duel', 'boxfight'] as const) it('debug ' + mode, () => {
  const m = new Match({ mode: MODES[mode], difficulty: 'hard', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 3 });
  m.events.on('BUILD_PLACED', (e) => console.log('BUILD', m.time.toFixed(1), e.piece.type, JSON.stringify(e.piece.grid)));
  m.events.on('BUILD_EDITED', (e) => console.log('EDIT', m.time.toFixed(1), e.piece.editMask));
  const run = (s: number) => { for (let i = 0; i < s * 60; i++) m.step(1 / 60); };
  console.log('human', m.human.pos.toArray(), 'bot', m.combatants[1].pos.toArray());
  for (let k = 0; k < 8; k++) {
    run(3);
    const b = m.brains[0];
    console.log('t', m.time.toFixed(0), m.phase, b.describe(), JSON.stringify((b as any).moveTarget), (b as any).detourUntil?.toFixed(1), b.self.pos.toArray().map(v => v.toFixed(1)).join(','), 'yaw', b.self.yaw.toFixed(2), 'in', b.self.input.forward.toFixed(2), b.self.input.right.toFixed(2), 'fire', b.self.input.fire, 'humanHP', m.human.health, m.human.shield, 'sel', b.self.inventory.selected);
  }
});
