import { it } from 'vitest';
import { Match } from '../../src/game/Match';
import { MODES } from '../../src/game/modes';
const cos = () => ({ outfit: 'default', backpack: 'none', pickaxe: 'default', glider: 'default', wrap: 'none', emote: 'wave' });
it('box', () => {
  const m = new Match({ mode: MODES.boxfight, difficulty: 'hard', playerName: 'T', cosmetics: cos(), botCosmetics: cos, seed: 3 });
  const b = m.brains[0] as any;
  for (let i = 0; i < 60 * 20; i++) {
    m.step(1 / 60);
    if (i % 60 === 0 && m.time > 3) console.log(m.time.toFixed(2), b.state, 'fwd', b.self.input.forward.toFixed(2), b.self.input.right.toFixed(2), 'pos', b.self.pos.x.toFixed(2), b.self.pos.z.toFixed(2), 'vel', b.self.vel.x.toFixed(2), b.self.vel.z.toFixed(2), 'g', b.self.grounded, 'mt', b.moveTarget && b.moveTarget.x.toFixed(1));
  }
});
