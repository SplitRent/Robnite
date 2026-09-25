import type { BuildMaterial } from '../building/grid';

/** Original rarity tiers. Order matters (index = tier). */
export type Rarity = 'standard' | 'tuned' | 'prime' | 'elite' | 'apex';
export const RARITIES: readonly Rarity[] = ['standard', 'tuned', 'prime', 'elite', 'apex'];

export const RARITY_INFO: Record<Rarity, { label: string; color: string; tier: number }> = {
  standard: { label: 'Standard', color: '#9aa6b2', tier: 0 },
  tuned: { label: 'Tuned', color: '#3ccf8e', tier: 1 },
  prime: { label: 'Prime', color: '#3f9dff', tier: 2 },
  elite: { label: 'Elite', color: '#c257ff', tier: 3 },
  apex: { label: 'Apex', color: '#ffb02e', tier: 4 },
};

export type AmmoType = 'light' | 'medium' | 'shells' | 'heavy';
export const AMMO_TYPES: readonly AmmoType[] = ['light', 'medium', 'shells', 'heavy'];
export const AMMO_LABEL: Record<AmmoType, string> = { light: 'Light', medium: 'Medium', shells: 'Shells', heavy: 'Heavy' };
export const AMMO_MAX: Record<AmmoType, number> = { light: 360, medium: 300, shells: 60, heavy: 40 };

export type WeaponId = 'ar' | 'smg' | 'shotgun' | 'marksman';
export type ConsumableId = 'shield_cell' | 'shield_canister' | 'patch_kit';

export interface WeaponStack {
  kind: 'weapon';
  id: WeaponId;
  rarity: Rarity;
  ammoInMag: number;
}

export interface ConsumableStack {
  kind: 'consumable';
  id: ConsumableId;
  count: number;
}

export interface AmmoStack {
  kind: 'ammo';
  ammo: AmmoType;
  count: number;
}

export interface MaterialStack {
  kind: 'material';
  material: BuildMaterial;
  count: number;
}

export type SlotItem = WeaponStack | ConsumableStack;
export type ItemStack = SlotItem | AmmoStack | MaterialStack;

export interface ConsumableDef {
  id: ConsumableId;
  name: string;
  useTime: number;
  maxStack: number;
  shield: number;
  /** Shield can't be raised above this by this item. */
  shieldCap: number;
  health: number;
  healthCap: number;
  rarity: Rarity;
}

export const CONSUMABLES: Record<ConsumableId, ConsumableDef> = {
  shield_cell: { id: 'shield_cell', name: 'Shield Cell', useTime: 2, maxStack: 6, shield: 25, shieldCap: 50, health: 0, healthCap: 100, rarity: 'tuned' },
  shield_canister: { id: 'shield_canister', name: 'Shield Canister', useTime: 4.5, maxStack: 3, shield: 50, shieldCap: 100, health: 0, healthCap: 100, rarity: 'prime' },
  patch_kit: { id: 'patch_kit', name: 'Patch Kit', useTime: 6, maxStack: 3, shield: 0, shieldCap: 100, health: 100, healthCap: 100, rarity: 'tuned' },
};

export function itemLabel(item: ItemStack): string {
  switch (item.kind) {
    case 'weapon':
      return `${RARITY_INFO[item.rarity].label} ${weaponNameLookup(item.id)}`;
    case 'consumable':
      return `${CONSUMABLES[item.id].name}${item.count > 1 ? ` x${item.count}` : ''}`;
    case 'ammo':
      return `${AMMO_LABEL[item.ammo]} Ammo x${item.count}`;
    case 'material':
      return `${item.material[0].toUpperCase()}${item.material.slice(1)} x${item.count}`;
  }
}

// Late-bound to avoid a circular import with weapons.ts.
let weaponNameLookup: (id: WeaponId) => string = (id) => id;
export function registerWeaponNames(fn: (id: WeaponId) => string): void {
  weaponNameLookup = fn;
}

export function itemRarity(item: ItemStack): Rarity {
  if (item.kind === 'weapon') return item.rarity;
  if (item.kind === 'consumable') return CONSUMABLES[item.id].rarity;
  return 'standard';
}
