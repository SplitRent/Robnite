import { h, clear } from '../dom';
import { ICONS } from '../icons';
import { MODES, PLAYABLE_MODES } from '../../game/modes';
import type { AppContext, Page } from '../context';
import type { BotDifficulty, ModeId } from '../../game/matchTypes';

const MODE_ART: Record<string, string> = {
  br: 'linear-gradient(135deg,#123a55 0%,#1f6d8c 45%,#f09a4a 100%)',
  duel: 'linear-gradient(135deg,#2a0d3a 0%,#7b1f6a 50%,#ff5ad1 100%)',
  boxfight: 'linear-gradient(135deg,#2a1a08 0%,#7a4a12 50%,#ff9d2e 100%)',
  zonewar: 'linear-gradient(135deg,#1a0f3a 0%,#4a2a8a 50%,#c257ff 100%)',
  freebuild: 'linear-gradient(135deg,#0d2a22 0%,#1f6a4f 50%,#3ccf8e 100%)',
};

export class PlayPage implements Page {
  readonly el: HTMLElement;
  private selected: ModeId;
  private detail: HTMLElement;
  private list: HTMLElement;

  constructor(private ctx: AppContext) {
    this.selected = 'br';
    this.list = h('div', { class: 'mode-list' });
    this.detail = h('div', { class: 'mode-detail panel-glass' });
    this.el = h('section', { class: 'page page-play' }, h('div', { class: 'page-head' }, h('h1', {}, 'PLAY'), h('span', { class: 'chip chip-offline' }, h('span', { html: ICONS.bot }), 'OFFLINE · BOTS ENABLED')), h('div', { class: 'play-layout' }, this.list, this.detail));
  }

  show(): void {
    this.render();
  }

  select(mode: ModeId): void {
    this.selected = mode;
    this.render();
  }

  private render(): void {
    const ctx = this.ctx;
    clear(this.list);
    for (const id of PLAYABLE_MODES) {
      const m = MODES[id];
      const card = h('button', { class: `mode-card ${id === this.selected ? 'selected' : ''}`, style: `--mode-art:${MODE_ART[id]};--accent:${m.accent}`, onclick: () => this.select(id) },
        h('div', { class: 'mode-card-name' }, m.name.toUpperCase()),
        h('div', { class: 'mode-card-tag' }, m.tagline),
        h('div', { class: 'mode-card-meta' }, `${m.maxPlayers} PLAYERS · ${m.durationLabel.toUpperCase()}`),
      );
      card.addEventListener('mouseenter', () => ctx.audio.ui('hover'));
      card.addEventListener('dblclick', () => this.start());
      this.list.appendChild(card);
    }
    const m = MODES[this.selected];
    const diff = ctx.save.data.settings.gameplay.botDifficulty;
    clear(this.detail);
    const diffBtns = (['easy', 'normal', 'hard', 'elite'] as BotDifficulty[]).map((d) =>
      h('button', { class: `seg ${d === diff ? 'active' : ''}`, onclick: () => {
        ctx.save.data.settings.gameplay.botDifficulty = d;
        ctx.save.save();
        ctx.audio.ui('click');
        this.render();
      } }, d.toUpperCase()),
    );
    this.detail.append(
      h('div', { class: 'mode-hero', style: `--mode-art:${MODE_ART[this.selected]};--accent:${m.accent}` }, h('div', { class: 'mode-hero-title' }, m.name.toUpperCase()), h('div', { class: 'mode-hero-map' }, m.mapName.toUpperCase())),
      h('p', { class: 'mode-desc' }, m.description),
      h('div', { class: 'mode-stats' },
        stat('PLAYERS', `${m.maxPlayers} (${m.bots ? `1 + ${m.bots} bots` : 'solo'})`),
        stat('DURATION', m.durationLabel),
        stat('MAP', m.mapName),
        stat('STORM', m.storm ? 'Yes' : 'No'),
        stat('LOOT', m.loot ? 'Floor loot & chests' : 'Loadout provided'),
        stat('MATERIALS', m.materials === 'unlimited' ? 'Unlimited' : `${m.materials.wood} / ${m.materials.stone} / ${m.materials.metal}`),
      ),
      m.bots > 0 ? h('div', { class: 'mode-diff' }, h('div', { class: 'label' }, 'BOT DIFFICULTY'), h('div', { class: 'segmented' }, diffBtns)) : h('div', { class: 'mode-diff' }, h('div', { class: 'label' }, 'PRACTICE'), h('div', { class: 'muted' }, 'Targets, strafing dummies, edit walls and build stations.')),
      h('div', { class: 'mode-status' }, h('span', { class: 'dot-live' }), 'BOTS ENABLED · OFFLINE MATCH · NO SERVER REQUIRED'),
      h('button', { class: 'btn btn-primary btn-xl', onclick: () => this.start() }, `START ${m.name.toUpperCase()}`),
      h('button', { class: 'btn btn-ghost', onclick: () => ctx.startMatch('tutorial', 'normal') }, 'PLAY TUTORIAL'),
    );
  }

  get selectedMode(): ModeId {
    return this.selected;
  }

  start(): void {
    this.ctx.startMatch(this.selected, this.ctx.save.data.settings.gameplay.botDifficulty);
  }
}

function stat(label: string, value: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));
}
