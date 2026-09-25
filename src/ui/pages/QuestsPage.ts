import { h, clear } from '../dom';
import { dayIndex } from '../../core/rng';
import { formatNumber } from '../../core/math';
import type { QuestProgress } from '../../quests/quests';
import type { AppContext, Page } from '../context';

export class QuestsPage implements Page {
  readonly el: HTMLElement;
  private body: HTMLElement;

  constructor(private ctx: AppContext) {
    this.body = h('div', { class: 'quests-body' });
    this.el = h('section', { class: 'page page-quests' }, h('div', { class: 'page-head' }, h('h1', {}, 'QUESTS')), this.body);
  }

  show(): void {
    this.ctx.progression.refreshQuests();
    this.render();
  }

  private render(): void {
    const q = this.ctx.save.data.quests;
    clear(this.body);
    const now = new Date();
    const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
    const daysToWeek = 7 - ((dayIndex() + 3) % 7);
    this.body.append(
      this.section('DAILY', `Resets in ${Math.floor(nextDay / 3600000)}h ${Math.floor((nextDay % 3600000) / 60000)}m`, q.daily),
      this.section('WEEKLY', `Resets in ${daysToWeek} day${daysToWeek === 1 ? '' : 's'}`, q.weekly),
      h('p', { class: 'muted small' }, 'Quest progress is tracked live during Battle Royale, Duel, Box Fight and Zone War matches. Rewards are granted automatically when a quest completes.'),
    );
  }

  private section(title: string, sub: string, list: QuestProgress[]): HTMLElement {
    return h('div', { class: 'quest-section panel-glass' },
      h('div', { class: 'quest-section-head' }, h('h2', {}, title), h('span', { class: 'muted small' }, sub)),
      list.map((qp) => {
        const def = this.ctx.progression.questDef(qp.id);
        if (!def) return null;
        const pct = Math.min(100, (qp.progress / def.goal) * 100);
        return h('div', { class: `quest ${qp.completed ? 'done' : ''}` },
          h('div', { class: 'quest-main' },
            h('div', { class: 'quest-title' }, def.title),
            h('div', { class: 'quest-desc muted' }, def.description),
            h('div', { class: 'quest-bar' }, h('div', { class: 'quest-fill', style: `width:${pct}%` })),
          ),
          h('div', { class: 'quest-side' },
            h('div', { class: 'quest-progress' }, qp.completed ? 'COMPLETE' : `${formatNumber(qp.progress)} / ${formatNumber(def.goal)}`),
            h('div', { class: 'quest-xp' }, `XP ${formatNumber(def.rewardXP)}`),
          ),
        );
      }),
    );
  }
}
