import { h, clear } from '../dom';
import { cosmeticPreview, ICONS } from '../icons';
import { CATEGORY_LABEL, type CosmeticItem } from '../../cosmetics/catalog';
import { SHOP_SECTIONS, msUntilRefresh, shopRotation, type ShopSection } from '../../cosmetics/shop';
import { RARITY_INFO } from '../../inventory/items';
import { formatNumber } from '../../core/math';
import type { AppContext, Page } from '../context';

export class ShopPage implements Page {
  readonly el: HTMLElement;
  private section: ShopSection = 'featured';
  private tabs: HTMLElement;
  private body: HTMLElement;
  private timer: HTMLElement;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private ctx: AppContext) {
    this.tabs = h('div', { class: 'subtabs' });
    this.body = h('div', { class: 'shop-body' });
    this.timer = h('span', { class: 'shop-timer' });
    this.el = h('section', { class: 'page page-shop' },
      h('div', { class: 'page-head' }, h('h1', {}, 'ITEM SHOP'), this.timer),
      h('p', { class: 'muted small' }, 'Cosmetic items only — purchased with Credits earned by playing. No real money. The rotation is generated locally each day.'),
      this.tabs, this.body);
  }

  show(): void {
    this.render();
    this.tick();
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => this.tick(), 1000);
  }

  hide(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private tick(): void {
    const ms = msUntilRefresh();
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    this.timer.textContent = `REFRESHES IN ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  private render(): void {
    const ctx = this.ctx;
    const rot = shopRotation();
    clear(this.tabs);
    for (const s of SHOP_SECTIONS) {
      this.tabs.appendChild(h('button', { class: `subtab ${s.id === this.section ? 'active' : ''}`, onclick: () => { this.section = s.id; ctx.audio.ui('click'); this.render(); } }, s.label));
    }
    clear(this.body);
    const items = rot.sections[this.section];
    const grid = h('div', { class: `shop-grid ${this.section === 'featured' ? 'featured' : ''}` });
    for (const item of items) grid.appendChild(this.card(item));
    this.body.appendChild(grid);
  }

  private card(item: CosmeticItem): HTMLElement {
    const ctx = this.ctx;
    const p = ctx.save.data.profile;
    const owned = p.inventory.includes(item.id);
    const equipped = Object.values(p.equipped).includes(item.id);
    const rarity = RARITY_INFO[item.rarity];
    const el = h('button', { class: `shop-card rarity-${item.rarity} ${owned ? 'owned' : ''}`, style: `--rarity:${rarity.color}`, onclick: () => this.open(item) },
      h('div', { class: 'shop-card-art', html: cosmeticPreview(item) }),
      h('div', { class: 'shop-card-foot' },
        h('div', { class: 'shop-card-name' }, item.name),
        h('div', { class: 'shop-card-type' }, `${rarity.label} ${CATEGORY_LABEL[item.category]}`),
        owned ? h('div', { class: 'shop-card-owned' }, equipped ? 'EQUIPPED' : 'OWNED') : h('div', { class: 'shop-card-price' }, h('span', { html: ICONS.credits }), formatNumber(item.price)),
      ),
    );
    el.addEventListener('mouseenter', () => ctx.audio.ui('hover'));
    return el;
  }

  private async open(item: CosmeticItem): Promise<void> {
    const ctx = this.ctx;
    const p = ctx.save.data.profile;
    const owned = p.inventory.includes(item.id);
    const rarity = RARITY_INFO[item.rarity];
    const body = h('div', { class: 'purchase-body' },
      h('div', { class: 'purchase-art', style: `--rarity:${rarity.color}`, html: cosmeticPreview(item) }),
      h('div', { class: 'purchase-info' },
        h('div', { class: 'rarity-tag', style: `--rarity:${rarity.color}` }, `${rarity.label.toUpperCase()} ${CATEGORY_LABEL[item.category].toUpperCase()}`),
        h('p', {}, item.description),
        h('div', { class: 'purchase-price' }, h('span', { html: ICONS.credits }), `${formatNumber(item.price)} Credits`),
        h('div', { class: 'muted small' }, `Your balance: ${formatNumber(p.currency)} Credits`),
      ),
    );
    if (owned) {
      await ctx.overlay.modal({ title: item.name, body, buttons: [{ id: 'close', label: 'CLOSE', kind: 'ghost' }] });
      return;
    }
    const choice = await ctx.overlay.modal({ title: item.name, body, buttons: [{ id: 'cancel', label: 'CANCEL', kind: 'ghost' }, { id: 'buy', label: `BUY · ${formatNumber(item.price)}`, kind: 'primary' }] });
    if (choice !== 'buy') return;
    if (p.currency < item.price) {
      ctx.audio.ui('error');
      await ctx.overlay.modal({ title: 'NOT ENOUGH CREDITS', body: `You need ${formatNumber(item.price - p.currency)} more Credits. Earn Credits by playing matches, completing the Battle Pass and logging in daily.`, buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }] });
      return;
    }
    const confirm = await ctx.overlay.confirm('CONFIRM PURCHASE', `Spend ${formatNumber(item.price)} Credits on ${item.name}?`, 'CONFIRM');
    if (!confirm) return;
    const r = await ctx.shop.purchase(item.id);
    if (!r.ok) {
      ctx.audio.ui('error');
      ctx.overlay.toast('PURCHASE FAILED', r.reason ?? '', 'warn');
      return;
    }
    ctx.audio.ui('purchase');
    ctx.overlay.toast('PURCHASE COMPLETE', `${item.name} added to your Locker`, 'good');
    ctx.refreshHeader();
    this.render();
    const eq = await ctx.overlay.modal({ title: 'PURCHASE SUCCESSFUL', body: `${item.name} is now in your Locker.`, buttons: [{ id: 'later', label: 'LATER', kind: 'ghost' }, { id: 'equip', label: 'EQUIP NOW', kind: 'primary' }] });
    if (eq === 'equip' && ctx.progression.equip(item.category, item.id)) {
      ctx.overlay.toast('ITEM EQUIPPED', item.name, 'good', 1800);
      ctx.refreshCharacter();
      this.render();
    }
  }
}
