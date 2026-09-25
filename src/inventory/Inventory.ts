import { AMMO_MAX, CONSUMABLES, type AmmoType, type ConsumableStack, type SlotItem, type WeaponStack } from './items';
import { WEAPONS } from '../weapons/weapons';
import { RARITY_INFO } from './items';

export const SLOT_COUNT = 5;
export type Selection = number | 'pickaxe';

/** Five quick slots + dedicated pickaxe + ammo pouch. */
export class Inventory {
  slots: (SlotItem | null)[] = new Array(SLOT_COUNT).fill(null);
  selected: Selection = 'pickaxe';
  ammo: Record<AmmoType, number> = { light: 0, medium: 0, shells: 0, heavy: 0 };
  unlimitedAmmo = false;

  clear(): void {
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.selected = 'pickaxe';
    this.ammo = { light: 0, medium: 0, shells: 0, heavy: 0 };
  }

  get current(): SlotItem | null {
    return this.selected === 'pickaxe' ? null : this.slots[this.selected];
  }

  currentWeapon(): WeaponStack | null {
    const c = this.current;
    return c && c.kind === 'weapon' ? c : null;
  }

  firstEmpty(): number {
    return this.slots.findIndex((s) => s === null);
  }

  /** Add a weapon or consumable. Returns true if fully added. */
  add(item: SlotItem): boolean {
    if (item.kind === 'consumable') {
      const max = CONSUMABLES[item.id].maxStack;
      for (const s of this.slots) {
        if (s && s.kind === 'consumable' && s.id === item.id && s.count < max) {
          const take = Math.min(max - s.count, item.count);
          s.count += take;
          item.count -= take;
          if (item.count <= 0) return true;
        }
      }
    }
    const idx = this.firstEmpty();
    if (idx < 0) return false;
    this.slots[idx] = item.kind === 'weapon' ? { ...item } : { ...item };
    if (item.kind === 'consumable') item.count = 0;
    return true;
  }

  hasRoomFor(item: SlotItem): boolean {
    if (this.firstEmpty() >= 0) return true;
    if (item.kind === 'consumable') {
      return this.slots.some((s) => s && s.kind === 'consumable' && s.id === item.id && s.count < CONSUMABLES[item.id].maxStack);
    }
    return false;
  }

  addAmmo(type: AmmoType, count: number): number {
    const before = this.ammo[type];
    this.ammo[type] = Math.min(AMMO_MAX[type], before + count);
    return this.ammo[type] - before;
  }

  /** Remove the item in a slot, returning it. */
  take(slot: number): SlotItem | null {
    const it = this.slots[slot];
    this.slots[slot] = null;
    return it;
  }

  consumeOne(slot: number): void {
    const it = this.slots[slot];
    if (!it || it.kind !== 'consumable') return;
    it.count -= 1;
    if (it.count <= 0) this.slots[slot] = null;
  }

  weaponScore(w: WeaponStack): number {
    return RARITY_INFO[w.rarity].tier + (WEAPONS[w.id].damage > 50 ? 0.5 : 0);
  }

  hasWeapon(id: string): boolean {
    return this.slots.some((s) => s && s.kind === 'weapon' && s.id === id);
  }

  weapons(): WeaponStack[] {
    return this.slots.filter((s): s is WeaponStack => !!s && s.kind === 'weapon');
  }

  consumables(): ConsumableStack[] {
    return this.slots.filter((s): s is ConsumableStack => !!s && s.kind === 'consumable');
  }

  slotOf(item: SlotItem): number {
    return this.slots.indexOf(item);
  }
}
