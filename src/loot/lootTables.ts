import { Rng } from '../core/rng';
import { CONSUMABLES, RARITIES, type AmmoType, type ConsumableId, type ItemStack, type Rarity, type WeaponId } from '../inventory/items';
import { WEAPONS } from '../weapons/weapons';

export interface LootEntry {
  id: string;
  type: 'weapon' | 'consumable' | 'ammo' | 'material';
  spawnWeight: number;
  value: number;
}

/** Data-driven loot pool. */
export const LOOT_POOL: LootEntry[] = [
  { id: 'ar', type: 'weapon', spawnWeight: 14, value: 5 },
  { id: 'smg', type: 'weapon', spawnWeight: 12, value: 4 },
  { id: 'shotgun', type: 'weapon', spawnWeight: 13, value: 5 },
  { id: 'marksman', type: 'weapon', spawnWeight: 5, value: 6 },
  { id: 'shield_cell', type: 'consumable', spawnWeight: 10, value: 3 },
  { id: 'shield_canister', type: 'consumable', spawnWeight: 4, value: 5 },
  { id: 'patch_kit', type: 'consumable', spawnWeight: 7, value: 4 },
  { id: 'light', type: 'ammo', spawnWeight: 6, value: 1 },
  { id: 'medium', type: 'ammo', spawnWeight: 6, value: 1 },
  { id: 'shells', type: 'ammo', spawnWeight: 6, value: 1 },
  { id: 'heavy', type: 'ammo', spawnWeight: 3, value: 1 },
  { id: 'wood', type: 'material', spawnWeight: 3, value: 1 },
  { id: 'stone', type: 'material', spawnWeight: 2, value: 1 },
  { id: 'metal', type: 'material', spawnWeight: 1, value: 1 },
];

export const AMMO_DROP: Record<AmmoType, number> = { light: 36, medium: 30, shells: 8, heavy: 6 };

const RARITY_WEIGHTS: Record<'floor' | 'chest' | 'supply', number[]> = {
  floor: [42, 30, 17, 8, 3],
  chest: [18, 32, 28, 16, 6],
  supply: [0, 0, 40, 40, 20],
};

export function rollRarity(rng: Rng, table: keyof typeof RARITY_WEIGHTS): Rarity {
  const w = RARITY_WEIGHTS[table];
  return rng.weighted(RARITIES, (r) => w[RARITIES.indexOf(r)]);
}

export function makeWeapon(id: WeaponId, rarity: Rarity): ItemStack {
  return { kind: 'weapon', id, rarity, ammoInMag: WEAPONS[id].magSize };
}

export function makeConsumable(id: ConsumableId, count = 1): ItemStack {
  return { kind: 'consumable', id, count: Math.min(count, CONSUMABLES[id].maxStack) };
}

function entryToItems(rng: Rng, e: LootEntry, table: 'floor' | 'chest' | 'supply'): ItemStack[] {
  switch (e.type) {
    case 'weapon': {
      const id = e.id as WeaponId;
      const w = makeWeapon(id, rollRarity(rng, table));
      const ammo = WEAPONS[id].ammo;
      return [w, { kind: 'ammo', ammo, count: AMMO_DROP[ammo] }];
    }
    case 'consumable': {
      const id = e.id as ConsumableId;
      return [makeConsumable(id, id === 'shield_cell' ? 3 : 1)];
    }
    case 'ammo': {
      const a = e.id as AmmoType;
      return [{ kind: 'ammo', ammo: a, count: AMMO_DROP[a] }];
    }
    case 'material':
      return [{ kind: 'material', material: e.id as 'wood' | 'stone' | 'metal', count: 30 }];
  }
}

export function rollFloorLoot(rng: Rng): ItemStack[] {
  const e = rng.weighted(LOOT_POOL, (x) => x.spawnWeight);
  return entryToItems(rng, e, 'floor');
}

export function rollChestLoot(rng: Rng, supply: boolean): ItemStack[] {
  const table = supply ? 'supply' : 'chest';
  const weapons = LOOT_POOL.filter((e) => e.type === 'weapon');
  const consumables = LOOT_POOL.filter((e) => e.type === 'consumable');
  const out: ItemStack[] = [];
  out.push(...entryToItems(rng, rng.weighted(weapons, (x) => x.spawnWeight), table));
  out.push(...entryToItems(rng, supply ? consumables[1] : rng.weighted(consumables, (x) => x.spawnWeight), table));
  if (supply) out.push(...entryToItems(rng, rng.weighted(weapons, (x) => x.spawnWeight), table));
  out.push({ kind: 'material', material: rng.pick(['wood', 'stone', 'metal'] as const), count: supply ? 100 : 30 });
  return out;
}
