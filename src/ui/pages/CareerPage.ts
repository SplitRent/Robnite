import { h, clear } from '../dom';
import { formatNumber, formatTime } from '../../core/math';
import { MODES } from '../../game/modes';
import type { AppContext, Page } from '../context';

export class CareerPage implements Page {
  readonly el: HTMLElement;
  private body: HTMLElement;

  constructor(private ctx: AppContext) {
    this.body = h('div', { class: 'career-body' });
    this.el = h('section', { class: 'page page-career' }, h('div', { class: 'page-head' }, h('h1', {}, 'CAREER')), this.body);
  }

  show(): void {
    const d = this.ctx.save.data;
    const s = d.stats;
    clear(this.body);
    const hours = s.playTime / 3600;
    const tile = (label: string, value: string) => h('div', { class: 'career-tile panel-glass' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'career-value' }, value));
    const fav = this.ctx.progression.favoriteMode();
    this.body.append(
      h('div', { class: 'career-grid' },
        tile('MATCHES', formatNumber(s.matches)),
        tile('WINS', formatNumber(s.wins)),
        tile('WIN RATE', s.matches ? `${((s.wins / s.matches) * 100).toFixed(1)}%` : '—'),
        tile('ELIMINATIONS', formatNumber(s.eliminations)),
        tile('DEATHS', formatNumber(s.deaths)),
        tile('K/D', s.deaths ? (s.eliminations / s.deaths).toFixed(2) : String(s.eliminations)),
        tile('DAMAGE', formatNumber(s.damage)),
        tile('BEST PLACEMENT', s.bestPlacement ? `#${s.bestPlacement}` : '—'),
        tile('BUILDS PLACED', formatNumber(s.buildsPlaced)),
        tile('EDITS', formatNumber(s.edits)),
        tile('HEADSHOTS', formatNumber(s.headshots)),
        tile('PLAY TIME', hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(s.playTime / 60)} min`),
        tile('FAVORITE MODE', fav ? MODES[fav as keyof typeof MODES]?.name ?? '—' : '—'),
        tile('CHESTS OPENED', formatNumber(s.chestsOpened)),
      ),
      h('h2', { class: 'section-title' }, 'RECENT MATCHES'),
      d.matchHistory.length
        ? h('div', { class: 'history' }, d.matchHistory.slice(0, 12).map((m) =>
            h('div', { class: `history-row ${m.won ? 'won' : ''}` },
              h('div', { class: 'history-mode' }, m.modeName, h('small', {}, new Date(m.timestamp).toLocaleString())),
              h('div', { class: 'history-place' }, m.won ? 'WON' : `#${m.placement}`),
              h('div', {}, `${m.eliminations} Elims`),
              h('div', {}, `${formatNumber(m.damage)} Damage`),
              h('div', {}, formatTime(m.survivalTime)),
              h('div', { class: 'history-xp' }, `+${formatNumber(m.xp)} XP`),
            )))
        : h('p', { class: 'muted' }, 'No matches yet — jump into a game from the PLAY tab.'),
    );
  }
}
