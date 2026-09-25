import { Rng, dayIndex } from '../core/rng';
import { COSMETICS, COSMETIC_BY_ID, type CosmeticCategory, type CosmeticItem } from './catalog';
import type { SaveManager } from '../save/SaveManager';

export type ShopSection = 'featured' | 'daily' | 'pickaxe' | 'outfit' | 'emote' | 'wrap';

export const SHOP_SECTIONS: { id: ShopSection; label: string }[] = [
  { id: 'featured', label: 'FEATURED' },
  { id: 'daily', label: 'DAILY' },
  { id: 'pickaxe', label: 'PICKAXES' },
  { id: 'outfit', label: 'OUTFITS' },
  { id: 'emote', label: 'EMOTES' },
  { id: 'wrap', label: 'WRAPS' },
];

export interface ShopRotation {
  day: number;
  sections: Record<ShopSection, CosmeticItem[]>;
}

/**
 * Deterministic daily rotation seeded by the local calendar day. This is an
 * offline game: the rotation is the same for everyone on the same day, but it
 * is computed locally, not synchronised by a server.
 */
export function shopRotation(date = new Date()): ShopRotation {
  const day = dayIndex(date);
  const rng = new Rng(`shop-${day}`);
  const pool = COSMETICS.filter((c) => c.source === 'shop' && c.price > 0);
  const shuffled = rng.shuffle([...pool]);
  const premium = shuffled.filter((c) => c.category === 'outfit' || c.rarity === 'elite' || c.rarity === 'apex');
  const featured = premium.slice(0, 2);
  const rest = shuffled.filter((c) => !featured.includes(c));
  const daily = rest.slice(0, 6);
  const cat = (category: CosmeticCategory, n: number) => rng.shuffle(pool.filter((c) => c.category === category)).slice(0, n);
  return {
    day,
    sections: {
      featured,
      daily,
      pickaxe: cat('pickaxe', 4),
      outfit: cat('outfit', 4),
      emote: cat('emote', 4),
      wrap: cat('wrap', 4),
    },
  };
}

export function msUntilRefresh(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export interface PurchaseResult {
  ok: boolean;
  reason?: string;
}

/**
 * Shop service abstraction. The local implementation spends fictional
 * Credits from the local save. A future online implementation would ask a
 * backend to validate the purchase instead.
 */
export interface ShopService {
  readonly kind: 'local' | 'remote';
  purchase(itemId: string): Promise<PurchaseResult>;
}

export class LocalShopService implements ShopService {
  readonly kind = 'local' as const;
  constructor(private save: SaveManager) {}

  async purchase(itemId: string): Promise<PurchaseResult> {
    const item = COSMETIC_BY_ID.get(itemId);
    const d = this.save.data;
    if (!item || item.price <= 0) return { ok: false, reason: 'Item is not for sale' };
    const rotation = shopRotation();
    const inShop = Object.values(rotation.sections).some((list) => list.some((c) => c.id === itemId));
    if (!inShop) return { ok: false, reason: 'Item is not in today\'s shop' };
    if (d.profile.inventory.includes(itemId)) return { ok: false, reason: 'Already owned' };
    if (d.profile.currency < item.price) return { ok: false, reason: 'Not enough Credits' };
    d.profile.currency -= item.price;
    d.profile.inventory.push(itemId);
    this.save.save();
    return { ok: true };
  }
}
