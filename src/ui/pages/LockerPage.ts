import { h, clear } from '../dom';
import { cosmeticPreview, ICONS } from '../icons';
import { CATEGORY_LABEL, COSMETICS, LOCKER_CATEGORIES, type CosmeticCategory, type CosmeticItem } from '../../cosmetics/catalog';
import { RARITY_INFO } from '../../inventory/items';
import { CURRENT_SEASON } from '../../season/season';
import type { AppContext, Page } from '../context';

export function sourceLabel(item: CosmeticItem): string {
  if (item.source === 'shop') return 'Item Shop';
  if (item.source === 'code') return 'Redeem code';
  if (item.source === 'battlepass') {
    const r = CURRENT_SEASON.battlePass.find((b) => b.freeReward === item.id || b.premiumReward === item.id);
    return r ? `Battle Pass · Tier ${r.level}${r.premiumReward === item.id ? ' (Premium)' : ''}` : 'Battle Pass';
  }
  return 'Default';
}

export class LockerPage implements Page {
  readonly el: HTMLElement;
  private category: CosmeticCategory = 'outfit';
  private selectedId: string | null = null;
  private tabs: HTMLElement;
  private grid: HTMLElement;
  private info: HTMLElement;

  constructor(private ctx: AppContext) {
    this.tabs = h('div', { class: 'subtabs' });
    this.grid = h('div', { class: 'item-grid' });
    this.info = h('div', { class: 'item-info panel-glass' });
    this.el = h('section', { class: 'page page-locker' }, h('div', { class: 'page-head' }, h('h1', {}, 'LOCKER')), this.tabs, h('div', { class: 'locker-layout' }, this.grid, this.info));
  }

  show(): void {
    this.render();
  }

  private render(): void {
    const ctx = this.ctx;
    const p = ctx.save.data.profile;
    clear(this.tabs);
    for (const c of LOCKER_CATEGORIES) {
      const eq = COSMETICS.find((x) => x.id === p.equipped[c]);
      this.tabs.appendChild(h('button', { class: `subtab ${c === this.category ? 'active' : ''}`, onclick: () => { this.category = c; this.selectedId = null; ctx.audio.ui('click'); this.render(); } }, h('span', {}, CATEGORY_LABEL[c].toUpperCase()), h('small', {}, eq?.name ?? '')));
    }
    const items = COSMETICS.filter((c) => c.category === this.category).sort((a, b) => Number(p.inventory.includes(b.id)) - Number(p.inventory.includes(a.id)) || RARITY_INFO[a.rarity].tier - RARITY_INFO[b.rarity].tier);
    if (!this.selectedId) this.selectedId = p.equipped[this.category];
    clear(this.grid);
    for (const item of items) {
      const owned = p.inventory.includes(item.id);
      const equipped = p.equipped[this.category] === item.id;
      const card = h('button', { class: `item-card rarity-${item.rarity} ${owned ? '' : 'locked'} ${item.id === this.selectedId ? 'selected' : ''} ${equipped ? 'equipped' : ''}`, style: `--rarity:${RARITY_INFO[item.rarity].color}`, onclick: () => { this.selectedId = item.id; ctx.audio.ui('click'); if (item.category === 'emote' && owned) ctx.lobby.playEmote(item.id); this.render(); }, ondblclick: () => owned && this.equip(item) },
        h('div', { class: 'item-preview', html: cosmeticPreview(item) }),
        h('div', { class: 'item-name' }, item.name),
        equipped ? h('div', { class: 'item-badge' }, 'EQUIPPED') : !owned ? h('div', { class: 'item-lock', html: ICONS.lock }) : null,
      );
      card.addEventListener('mouseenter', () => ctx.audio.ui('hover'));
      this.grid.appendChild(card);
    }
    const sel = COSMETICS.find((c) => c.id === this.selectedId);
    clear(this.info);
    if (sel) {
      const owned = p.inventory.includes(sel.id);
      const equipped = p.equipped[this.category] === sel.id;
      const children: (HTMLElement | null)[] = [
        h('div', { class: 'item-info-preview', html: cosmeticPreview(sel) }),
        h('div', { class: 'rarity-tag', style: `--rarity:${RARITY_INFO[sel.rarity].color}` }, `${RARITY_INFO[sel.rarity].label.toUpperCase()} ${CATEGORY_LABEL[sel.category].toUpperCase()}`),
        h('h2', {}, sel.name),
        h('p', { class: 'muted' }, sel.description),
        h('div', { class: 'item-source' }, owned ? 'OWNED' : `UNLOCK: ${sourceLabel(sel).toUpperCase()}`),
        owned
          ? h('button', { class: `btn ${equipped ? 'btn-ghost' : 'btn-primary'}`, disabled: equipped, onclick: () => this.equip(sel) }, equipped ? 'EQUIPPED' : 'EQUIP')
          : h('button', { class: 'btn btn-ghost', disabled: true }, 'NOT OWNED'),
        sel.category === 'emote' && owned ? h('button', { class: 'btn btn-ghost', onclick: () => ctx.lobby.playEmote(sel.id) }, 'PREVIEW EMOTE') : null,
      ];
      for (const c of children) if (c) this.info.appendChild(c);
    }
  }

  private equip(item: CosmeticItem): void {
    if (this.ctx.progression.equip(item.category, item.id)) {
      this.ctx.overlay.toast('ITEM EQUIPPED', item.name, 'good', 1800);
      this.ctx.refreshCharacter();
      this.ctx.refreshHeader();
      this.render();
    }
  }
}
