import { h, clear } from '../dom';
import { cosmeticPreview, ICONS } from '../icons';
import { BP_TIERS, BP_XP_PER_TIER, CURRENT_SEASON, rewardLabel } from '../../season/season';
import { COSMETIC_BY_ID } from '../../cosmetics/catalog';
import { RARITY_INFO } from '../../inventory/items';
import { formatNumber } from '../../core/math';
import type { AppContext, Page } from '../context';

export class BattlePassPage implements Page {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private track: HTMLElement;
  private scrolled = false;

  constructor(private ctx: AppContext) {
    this.head = h('div', { class: 'bp-head' });
    this.track = h('div', { class: 'bp-track' });
    this.el = h('section', { class: 'page page-bp' }, this.head, h('div', { class: 'bp-track-wrap' }, this.track));
    this.track.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        this.track.parentElement!.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }

  show(): void {
    this.render();
    if (!this.scrolled) {
      this.scrolled = true;
      requestAnimationFrame(() => {
        const cur = this.track.querySelector('.bp-col.current') as HTMLElement | null;
        if (cur) this.track.parentElement!.scrollLeft = Math.max(0, cur.offsetLeft - 200);
      });
    }
  }

  private render(): void {
    const ctx = this.ctx;
    const bp = ctx.save.data.battlePass;
    const prog = ctx.progression;
    clear(this.head);
    const pct = bp.level >= BP_TIERS ? 100 : (bp.xp / BP_XP_PER_TIER) * 100;
    this.head.append(
      h('div', {},
        h('div', { class: 'bp-season' }, `SEASON ${String(CURRENT_SEASON.number).padStart(2, '0')}`),
        h('h1', { class: 'bp-title' }, CURRENT_SEASON.name),
        h('div', { class: 'muted' }, CURRENT_SEASON.theme),
      ),
      h('div', { class: 'bp-level panel-glass' },
        h('div', { class: 'bp-level-num' }, h('small', {}, 'TIER'), String(bp.level)),
        h('div', { class: 'bp-level-bar' }, h('div', { class: 'bp-level-fill', style: `width:${pct}%` })),
        h('div', { class: 'bp-level-xp' }, bp.level >= BP_TIERS ? 'MAX TIER' : `${formatNumber(bp.xp)} / ${formatNumber(BP_XP_PER_TIER)} XP`),
        bp.xpBoost > 0 ? h('div', { class: 'muted small' }, `Match XP boost: +${bp.xpBoost}%`) : null,
      ),
      h('div', { class: 'bp-premium panel-glass' },
        bp.premium
          ? h('div', { class: 'bp-premium-owned' }, h('span', { html: ICONS.check }), 'PREMIUM TRACK UNLOCKED')
          : h('div', {},
              h('div', { class: 'bp-premium-title' }, 'PREMIUM TRACK'),
              h('div', { class: 'muted small' }, 'Cosmetic rewards only. Unlocked with in-game Credits — no real money.'),
              h('button', { class: 'btn btn-primary', onclick: () => this.buyPremium() }, h('span', { html: ICONS.credits }), `UNLOCK · ${formatNumber(CURRENT_SEASON.premiumPrice)}`),
            ),
        prog.claimableCount() > 0 ? h('button', { class: 'btn btn-accent', onclick: () => this.claimAll() }, `CLAIM ALL (${prog.claimableCount()})`) : null,
      ),
    );
    clear(this.track);
    for (const r of CURRENT_SEASON.battlePass) {
      const col = h('div', { class: `bp-col ${r.level === bp.level ? 'current' : ''} ${r.level <= bp.level ? 'reached' : ''}` },
        h('div', { class: 'bp-col-level' }, `LEVEL ${r.level}`),
        this.cell(r.level, 'free', r.freeReward),
        this.cell(r.level, 'premium', r.premiumReward),
      );
      this.track.appendChild(col);
    }
  }

  private cell(level: number, track: 'free' | 'premium', reward: string | undefined): HTMLElement {
    const ctx = this.ctx;
    const state = ctx.progression.rewardState(level, track);
    if (!reward) return h('div', { class: `bp-cell empty ${track}` }, h('span', { class: 'muted small' }, track === 'free' ? 'FREE' : 'PREMIUM'));
    const item = COSMETIC_BY_ID.get(reward);
    const art = item ? cosmeticPreview(item) : reward.startsWith('credits') ? `<div class="bp-credits">${ICONS.credits}<b>${reward.split(':')[1]}</b></div>` : `<div class="bp-boost"><b>+${reward.split(':')[1]}%</b><small>XP</small></div>`;
    const color = item ? RARITY_INFO[item.rarity].color : reward.startsWith('credits') ? '#ffb02e' : '#3ccf8e';
    const el = h('div', { class: `bp-cell ${track} ${state}`, style: `--rarity:${color}` },
      h('div', { class: 'bp-cell-track' }, track === 'free' ? 'FREE' : 'PREMIUM'),
      h('div', { class: 'bp-cell-art', html: art }),
      h('div', { class: 'bp-cell-name' }, rewardLabel(reward)),
      state === 'claimable' ? h('button', { class: 'btn btn-primary btn-xs', onclick: (e: Event) => { e.stopPropagation(); this.claim(level, track, el); } }, 'CLAIM') : null,
      state === 'claimed' ? h('div', { class: 'bp-cell-state', html: ICONS.check }) : null,
      state === 'locked' || state === 'premium-locked' ? h('div', { class: 'bp-cell-state locked', html: ICONS.lock }) : null,
    );
    return el;
  }

  private claim(level: number, track: 'free' | 'premium', el: HTMLElement): void {
    const reward = this.ctx.progression.claimReward(level, track);
    if (!reward) return;
    el.classList.add('claiming');
    this.ctx.audio.ui('reward');
    this.ctx.overlay.toast('NEW REWARD', rewardLabel(reward), 'good');
    this.ctx.refreshHeader();
    setTimeout(() => this.render(), 450);
  }

  private claimAll(): void {
    let n = 0;
    for (let l = 1; l <= BP_TIERS; l++) {
      for (const t of ['free', 'premium'] as const) if (this.ctx.progression.claimReward(l, t)) n++;
    }
    if (n) {
      this.ctx.audio.ui('reward');
      this.ctx.overlay.toast('REWARDS CLAIMED', `${n} rewards added`, 'good');
      this.ctx.refreshHeader();
      this.render();
    }
  }

  private async buyPremium(): Promise<void> {
    const ctx = this.ctx;
    const ok = await ctx.overlay.confirm('UNLOCK PREMIUM TRACK', `Spend ${formatNumber(CURRENT_SEASON.premiumPrice)} Credits to unlock the cosmetic premium rewards for ${CURRENT_SEASON.name}? Premium rewards never affect gameplay.`, 'UNLOCK');
    if (!ok) return;
    const r = ctx.progression.buyPremium();
    if (!r.ok) {
      ctx.audio.ui('error');
      ctx.overlay.toast('CANNOT UNLOCK', r.reason ?? '', 'warn');
      return;
    }
    ctx.audio.ui('purchase');
    ctx.overlay.toast('PREMIUM UNLOCKED', 'Claim your premium rewards!', 'good');
    ctx.refreshHeader();
    this.render();
  }
}
