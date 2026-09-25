import type { Rarity } from '../inventory/items';

export type CosmeticCategory = 'outfit' | 'backpack' | 'pickaxe' | 'glider' | 'emote' | 'wrap' | 'banner' | 'loading';

export const CATEGORY_LABEL: Record<CosmeticCategory, string> = {
  outfit: 'Outfit',
  backpack: 'Back Accessory',
  pickaxe: 'Pickaxe',
  glider: 'Glider',
  emote: 'Emote',
  wrap: 'Wrap',
  banner: 'Banner',
  loading: 'Loading Screen',
};

export const LOCKER_CATEGORIES: CosmeticCategory[] = ['outfit', 'backpack', 'pickaxe', 'glider', 'emote', 'wrap', 'banner', 'loading'];

export type OutfitStyle = 'recruit' | 'scout' | 'heavy' | 'tech' | 'ranger' | 'punk' | 'marshal';
export type Headgear = 'none' | 'cap' | 'helmet' | 'visor' | 'hood' | 'beanie' | 'crown' | 'mask' | 'goggles';

export interface OutfitLook {
  skin: number;
  primary: number;
  secondary: number;
  accent: number;
  style: OutfitStyle;
  head: Headgear;
  hair: number;
  body: 'a' | 'b';
  glow?: boolean;
}
export interface PickaxeLook {
  head: number;
  handle: number;
  shape: 'pick' | 'axe' | 'hammer' | 'scythe';
  glow?: boolean;
}
export interface GliderLook {
  color: number;
  color2: number;
  shape: 'chute' | 'wing' | 'delta';
}
export interface BackpackLook {
  shape: 'none' | 'pack' | 'cell' | 'satchel' | 'antenna' | 'fins' | 'crate' | 'core';
  color: number;
  color2: number;
}
export interface WrapLook {
  color: number;
  color2: number;
  emissive: boolean;
}
export interface BannerLook {
  icon: 'summit' | 'picks' | 'eye' | 'bolt' | 'crown' | 'skull' | 'tree' | 'grid' | 'flame' | 'star';
  bg: string;
  fg: string;
}
export interface EmoteLook {
  anim: 'wave' | 'victory' | 'point' | 'dance' | 'celebrate' | 'thumbs' | 'salute' | 'robot' | 'spin';
}
export interface LoadingLook {
  from: string;
  to: string;
  motif: string;
}

export type CosmeticLook = OutfitLook | PickaxeLook | GliderLook | BackpackLook | WrapLook | BannerLook | EmoteLook | LoadingLook;

export interface CosmeticItem {
  id: string;
  name: string;
  category: CosmeticCategory;
  rarity: Rarity;
  /** Price in Credits (0 = not sold in the shop). */
  price: number;
  description: string;
  /** Where the item comes from. */
  source: 'default' | 'shop' | 'battlepass' | 'code';
  look: CosmeticLook;
}

const O = (id: string, name: string, rarity: Rarity, price: number, source: CosmeticItem['source'], description: string, look: OutfitLook): CosmeticItem => ({ id, name, category: 'outfit', rarity, price, description, source, look });

export const COSMETICS: CosmeticItem[] = [
  // ---------------- Outfits
  O('outfit_recruit', 'Recruit', 'standard', 0, 'default', 'Standard issue for every new arrival in Hollow Ridge.', { skin: 0xd9a47c, primary: 0x3d6fa8, secondary: 0x2c3440, accent: 0xf2b634, style: 'recruit', head: 'none', hair: 0x3b2a1e, body: 'a' }),
  O('outfit_recruit_b', 'Recruit Vale', 'standard', 0, 'default', 'Same gear, different attitude.', { skin: 0x8d5a3b, primary: 0x4b8a5c, secondary: 0x2c3440, accent: 0xef7d2d, style: 'recruit', head: 'none', hair: 0x1a1412, body: 'b' }),
  O('outfit_ridge_runner', 'Ridge Runner', 'tuned', 800, 'shop', 'Knows every shortcut between Ridgeway and the lake.', { skin: 0xe8b894, primary: 0xd9763a, secondary: 0x3a3f47, accent: 0xffffff, style: 'scout', head: 'cap', hair: 0x6b4226, body: 'a' }),
  O('outfit_circuit', 'Circuit Breaker', 'prime', 1200, 'shop', 'Former Skyline Labs technician. Still has the keycard.', { skin: 0xc68d6a, primary: 0x1f2833, secondary: 0x2bb3b1, accent: 0x5ee7ff, style: 'tech', head: 'visor', hair: 0x111111, body: 'b', glow: true }),
  O('outfit_ember', 'Ember Warden', 'elite', 1500, 'shop', 'Walks out of the storm unbothered.', { skin: 0x9c6644, primary: 0x7a1f1f, secondary: 0x2a1a14, accent: 0xff7b2e, style: 'heavy', head: 'helmet', hair: 0x000000, body: 'a', glow: true }),
  O('outfit_glacier', 'Glacier Scout', 'tuned', 800, 'shop', 'Cold weather, colder aim.', { skin: 0xf1c9a5, primary: 0xdfefff, secondary: 0x6fa8dc, accent: 0x2f5d8a, style: 'scout', head: 'beanie', hair: 0xe0d0b0, body: 'b' }),
  O('outfit_neon_nomad', 'Neon Nomad', 'elite', 1500, 'shop', 'Travels light. Glows bright.', { skin: 0x7a4b32, primary: 0x2a1740, secondary: 0xff3fd1, accent: 0x45f5ff, style: 'punk', head: 'goggles', hair: 0xff3fd1, body: 'a', glow: true }),
  O('outfit_iron_sentinel', 'Iron Sentinel', 'prime', 1200, 'shop', 'Forged at the Ironworks. Literally.', { skin: 0xb08260, primary: 0x6e7781, secondary: 0x3b4149, accent: 0xf2b634, style: 'heavy', head: 'helmet', hair: 0x000000, body: 'a' }),
  O('outfit_moss_ranger', 'Moss Ranger', 'tuned', 800, 'shop', 'Guardian of the Overgrown Chapel grounds.', { skin: 0xd9a47c, primary: 0x4f6d3d, secondary: 0x6b4a2c, accent: 0xc9d77a, style: 'ranger', head: 'hood', hair: 0x4a3222, body: 'b' }),
  O('outfit_solar_flare', 'Solar Flare', 'apex', 2000, 'shop', 'Charged by the containment tower at noon.', { skin: 0xe0ac86, primary: 0xffb02e, secondary: 0xfff1c9, accent: 0xff5a1f, style: 'tech', head: 'crown', hair: 0xffe08a, body: 'a', glow: true }),
  O('outfit_night_courier', 'Night Courier', 'prime', 1200, 'shop', 'Delivers packages. Mostly the pointy kind.', { skin: 0x5c3a28, primary: 0x1b1f2a, secondary: 0x3c4a66, accent: 0xa6ff4d, style: 'scout', head: 'mask', hair: 0x0b0b0b, body: 'b' }),
  O('outfit_quarry_boss', 'Quarry Boss', 'tuned', 0, 'battlepass', 'Runs the Old Quarry with an iron hard hat.', { skin: 0xc98e6b, primary: 0xf2b634, secondary: 0x3a3f47, accent: 0xef7d2d, style: 'heavy', head: 'cap', hair: 0x3b2a1e, body: 'a' }),
  O('outfit_storm_chaser', 'Storm Chaser', 'elite', 0, 'battlepass', 'Always one step inside the circle.', { skin: 0xe8b894, primary: 0x3c2a6b, secondary: 0x9a7bff, accent: 0x5ee7ff, style: 'punk', head: 'goggles', hair: 0xb79cff, body: 'b', glow: true }),
  O('outfit_lab_rat', 'Lab Rat', 'prime', 0, 'battlepass', 'Escaped Skyline Labs with a clipboard and a grudge.', { skin: 0xf1c9a5, primary: 0xf2f4f5, secondary: 0x2bb3b1, accent: 0x3ccf8e, style: 'tech', head: 'goggles', hair: 0x8a5a35, body: 'a' }),
  O('outfit_fallen_vanguard', 'Fallen Vanguard', 'elite', 0, 'battlepass', 'Season 01 premium reward. The first to fall, the last to leave.', { skin: 0xb08260, primary: 0x2c3a2e, secondary: 0xb3452f, accent: 0xffd23f, style: 'marshal', head: 'helmet', hair: 0x000000, body: 'a' }),
  O('outfit_frontier_marshal', 'Frontier Marshal', 'apex', 0, 'battlepass', 'Tier 50 — the law of the Fallen Frontier.', { skin: 0xd9a47c, primary: 0x5b3a22, secondary: 0xe8d9b5, accent: 0xffb02e, style: 'marshal', head: 'cap', hair: 0x2a1a10, body: 'b', glow: true }),
  O('outfit_founder', 'Founder', 'elite', 0, 'code', 'Redeemed with a launch code. Thanks for playing early.', { skin: 0xe0ac86, primary: 0x0f3b57, secondary: 0x5ee7ff, accent: 0xffffff, style: 'recruit', head: 'visor', hair: 0x222222, body: 'a', glow: true }),

  // ---------------- Back accessories
  { id: 'backpack_none', name: 'No Back Accessory', category: 'backpack', rarity: 'standard', price: 0, description: 'Travel light.', source: 'default', look: { shape: 'none', color: 0, color2: 0 } },
  { id: 'backpack_utility', name: 'Utility Pack', category: 'backpack', rarity: 'standard', price: 0, description: 'Pockets for days.', source: 'default', look: { shape: 'pack', color: 0x4b5563, color2: 0xf2b634 } },
  { id: 'backpack_cell', name: 'Energy Cell', category: 'backpack', rarity: 'prime', price: 800, description: 'Hums quietly. Probably safe.', source: 'shop', look: { shape: 'cell', color: 0x1f2833, color2: 0x5ee7ff } },
  { id: 'backpack_satchel', name: 'Mini Satchel', category: 'backpack', rarity: 'tuned', price: 400, description: 'Snacks not included.', source: 'shop', look: { shape: 'satchel', color: 0x8a5a35, color2: 0xe8d9b5 } },
  { id: 'backpack_antenna', name: 'Signal Antenna', category: 'backpack', rarity: 'tuned', price: 500, description: 'Salvaged from Relay Station 7.', source: 'shop', look: { shape: 'antenna', color: 0x3b4149, color2: 0xff3b30 } },
  { id: 'backpack_fins', name: 'Wing Fins', category: 'backpack', rarity: 'elite', price: 1000, description: 'Aerodynamically questionable.', source: 'battlepass', look: { shape: 'fins', color: 0x9a7bff, color2: 0x5ee7ff } },
  { id: 'backpack_crate', name: 'Crate Pack', category: 'backpack', rarity: 'standard', price: 0, description: 'It was a chest once.', source: 'battlepass', look: { shape: 'crate', color: 0x8a5a35, color2: 0xf2b634 } },
  { id: 'backpack_core', name: 'Storm Core', category: 'backpack', rarity: 'apex', price: 0, description: 'A shard of the storm, contained.', source: 'battlepass', look: { shape: 'core', color: 0x2a1740, color2: 0xc257ff } },

  // ---------------- Pickaxes
  { id: 'pickaxe_default', name: 'Standard Issue', category: 'pickaxe', rarity: 'standard', price: 0, description: 'Reliable. Unremarkable.', source: 'default', look: { head: 0x9aa4ad, handle: 0x5b3a22, shape: 'pick' } },
  { id: 'pickaxe_splitter', name: 'Ridge Splitter', category: 'pickaxe', rarity: 'tuned', price: 500, description: 'Splits logs and arguments.', source: 'shop', look: { head: 0xc9443a, handle: 0x3a2a1e, shape: 'axe' } },
  { id: 'pickaxe_neon', name: 'Neon Chopper', category: 'pickaxe', rarity: 'elite', price: 1200, description: 'Harvesting, but make it glow.', source: 'shop', look: { head: 0xff3fd1, handle: 0x1b1f2a, shape: 'axe', glow: true } },
  { id: 'pickaxe_frost', name: 'Frost Pick', category: 'pickaxe', rarity: 'prime', price: 800, description: 'Cold to the touch.', source: 'shop', look: { head: 0x9fd8ee, handle: 0xdfefff, shape: 'pick' } },
  { id: 'pickaxe_circuit', name: 'Circuit Hammer', category: 'pickaxe', rarity: 'prime', price: 800, description: 'Percussive maintenance tool.', source: 'shop', look: { head: 0x2bb3b1, handle: 0x1f2833, shape: 'hammer', glow: true } },
  { id: 'pickaxe_reaper', name: 'Harvest Moon', category: 'pickaxe', rarity: 'elite', price: 0, description: 'Curved like the last crescent.', source: 'battlepass', look: { head: 0xe8e8f0, handle: 0x2a1740, shape: 'scythe' } },
  { id: 'pickaxe_gold', name: 'Golden Grip', category: 'pickaxe', rarity: 'apex', price: 1500, description: 'Heavier than it needs to be.', source: 'shop', look: { head: 0xffc83d, handle: 0x5b3a22, shape: 'pick', glow: true } },
  { id: 'pickaxe_quarry', name: 'Quarry Breaker', category: 'pickaxe', rarity: 'tuned', price: 0, description: 'Standard equipment at the Old Quarry.', source: 'battlepass', look: { head: 0xf2b634, handle: 0x3a3f47, shape: 'hammer' } },

  // ---------------- Gliders
  { id: 'glider_default', name: 'Standard Chute', category: 'glider', rarity: 'standard', price: 0, description: 'Gets you down. Usually in one piece.', source: 'default', look: { color: 0x3d6fa8, color2: 0xe8e8e8, shape: 'chute' } },
  { id: 'glider_kite', name: 'Kite Wing', category: 'glider', rarity: 'tuned', price: 500, description: 'Handmade from lake cabin curtains.', source: 'shop', look: { color: 0xef7d2d, color2: 0xf2b634, shape: 'wing' } },
  { id: 'glider_delta', name: 'Delta Glider', category: 'glider', rarity: 'prime', price: 800, description: 'Sharp lines, soft landings.', source: 'shop', look: { color: 0x22324a, color2: 0x5ee7ff, shape: 'delta' } },
  { id: 'glider_neon', name: 'Neon Sail', category: 'glider', rarity: 'elite', price: 1200, description: 'Visible from orbit.', source: 'shop', look: { color: 0xff3fd1, color2: 0x45f5ff, shape: 'wing' } },
  { id: 'glider_storm', name: 'Storm Rider', category: 'glider', rarity: 'elite', price: 0, description: 'Rides the leading edge of the storm.', source: 'battlepass', look: { color: 0x3c2a6b, color2: 0xc257ff, shape: 'delta' } },
  { id: 'glider_leaf', name: 'Leaf Glider', category: 'glider', rarity: 'tuned', price: 0, description: 'Borrowed from the Chapel grounds.', source: 'battlepass', look: { color: 0x4f8f47, color2: 0xc9d77a, shape: 'chute' } },

  // ---------------- Emotes
  { id: 'emote_wave', name: 'Wave', category: 'emote', rarity: 'standard', price: 0, description: 'Hello there.', source: 'default', look: { anim: 'wave' } },
  { id: 'emote_victory', name: 'Victory Pose', category: 'emote', rarity: 'tuned', price: 300, description: 'Strike it after the last circle.', source: 'shop', look: { anim: 'victory' } },
  { id: 'emote_point', name: 'Point', category: 'emote', rarity: 'standard', price: 200, description: 'You. Yes, you.', source: 'shop', look: { anim: 'point' } },
  { id: 'emote_dance', name: 'Grid Step', category: 'emote', rarity: 'prime', price: 500, description: 'A dance invented between rounds.', source: 'shop', look: { anim: 'dance' } },
  { id: 'emote_celebrate', name: 'Celebrate', category: 'emote', rarity: 'tuned', price: 0, description: 'Arms up!', source: 'battlepass', look: { anim: 'celebrate' } },
  { id: 'emote_thumbs', name: 'Thumbs Up', category: 'emote', rarity: 'standard', price: 200, description: 'Good game.', source: 'shop', look: { anim: 'thumbs' } },
  { id: 'emote_salute', name: 'Salute', category: 'emote', rarity: 'tuned', price: 0, description: 'Respect to the fallen.', source: 'battlepass', look: { anim: 'salute' } },
  { id: 'emote_robot', name: 'Servo Shuffle', category: 'emote', rarity: 'elite', price: 800, description: 'Learned from a Skyline Labs prototype.', source: 'shop', look: { anim: 'robot' } },
  { id: 'emote_spin', name: 'Top Spin', category: 'emote', rarity: 'prime', price: 0, description: 'Round and round.', source: 'battlepass', look: { anim: 'spin' } },

  // ---------------- Wraps
  { id: 'wrap_none', name: 'Factory Finish', category: 'wrap', rarity: 'standard', price: 0, description: 'The way it came out of the crate.', source: 'default', look: { color: 0x2d3238, color2: 0x4b5563, emissive: false } },
  { id: 'wrap_carbon', name: 'Carbon', category: 'wrap', rarity: 'tuned', price: 300, description: 'Matte black weave.', source: 'shop', look: { color: 0x15171a, color2: 0x3a3f47, emissive: false } },
  { id: 'wrap_toxic', name: 'Toxic', category: 'wrap', rarity: 'prime', price: 500, description: 'Do not lick.', source: 'shop', look: { color: 0x7cff4f, color2: 0x1b2a12, emissive: true } },
  { id: 'wrap_gilded', name: 'Gilded', category: 'wrap', rarity: 'apex', price: 1000, description: 'All that glitters.', source: 'shop', look: { color: 0xffc83d, color2: 0x8a6412, emissive: false } },
  { id: 'wrap_arctic', name: 'Arctic', category: 'wrap', rarity: 'tuned', price: 300, description: 'Snow camouflage.', source: 'shop', look: { color: 0xeaf6ff, color2: 0x9fbad0, emissive: false } },
  { id: 'wrap_magma', name: 'Magma', category: 'wrap', rarity: 'elite', price: 800, description: 'Still warm.', source: 'shop', look: { color: 0xff5a1f, color2: 0x2a0d05, emissive: true } },
  { id: 'wrap_circuit', name: 'Circuit', category: 'wrap', rarity: 'prime', price: 0, description: 'Traces of Skyline tech.', source: 'battlepass', look: { color: 0x2bb3b1, color2: 0x0f1c24, emissive: true } },
  { id: 'wrap_camo', name: 'Ridge Camo', category: 'wrap', rarity: 'tuned', price: 0, description: 'Blends into Hollow Ridge.', source: 'battlepass', look: { color: 0x5d7a3a, color2: 0x3b2a1e, emissive: false } },

  // ---------------- Banners
  ...(
    [
      ['banner_default', 'Recruit Crest', 'standard', 0, 'default', 'star', '#1f3b57', '#5ee7ff'],
      ['banner_summit', 'Summit', 'standard', 100, 'shop', 'summit', '#22324a', '#e8e8e8'],
      ['banner_picks', 'Crossed Picks', 'tuned', 0, 'battlepass', 'picks', '#5b3a22', '#f2b634'],
      ['banner_eye', 'Storm Eye', 'prime', 0, 'battlepass', 'eye', '#2a1740', '#c257ff'],
      ['banner_bolt', 'Lightning', 'tuned', 200, 'shop', 'bolt', '#1b1f2a', '#ffd23f'],
      ['banner_crown', 'Crown', 'elite', 0, 'battlepass', 'crown', '#3b2a12', '#ffb02e'],
      ['banner_skull', 'Last One Standing', 'prime', 300, 'shop', 'skull', '#111318', '#e8e8e8'],
      ['banner_tree', 'Pinewater', 'standard', 0, 'battlepass', 'tree', '#1f3a2a', '#8cd67a'],
      ['banner_grid', 'Grid', 'tuned', 0, 'battlepass', 'grid', '#0f2530', '#3ccf8e'],
      ['banner_flame', 'Ember', 'prime', 300, 'shop', 'flame', '#2a0d05', '#ff7b2e'],
    ] as const
  ).map(([id, name, rarity, price, source, icon, bg, fg]) => ({ id, name, category: 'banner' as const, rarity, price, description: 'Profile banner.', source, look: { icon, bg, fg } })),

  // ---------------- Loading screens
  { id: 'loading_dawn', name: 'Hollow Ridge Dawn', category: 'loading', rarity: 'standard', price: 0, description: 'First light over the valley.', source: 'default', look: { from: '#1c2f4a', to: '#e08a4a', motif: 'ridge' } },
  { id: 'loading_iron', name: 'Ironworks Night', category: 'loading', rarity: 'tuned', price: 0, description: 'The crane never sleeps.', source: 'battlepass', look: { from: '#0f1520', to: '#b8452d', motif: 'crane' } },
  { id: 'loading_skyline', name: 'Skyline Glow', category: 'loading', rarity: 'prime', price: 0, description: 'The containment tower at midnight.', source: 'battlepass', look: { from: '#07121c', to: '#2bb3b1', motif: 'tower' } },
  { id: 'loading_chapel', name: 'Chapel Mist', category: 'loading', rarity: 'tuned', price: 400, description: 'Something rings in the bell tower.', source: 'shop', look: { from: '#1a2420', to: '#8a9a7a', motif: 'chapel' } },
];

export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export function cosmetic(id: string | undefined): CosmeticItem | undefined {
  return id ? COSMETIC_BY_ID.get(id) : undefined;
}

export const DEFAULT_OWNED = COSMETICS.filter((c) => c.source === 'default').map((c) => c.id);

export const DEFAULT_EQUIPPED = {
  outfit: 'outfit_recruit',
  backpack: 'backpack_utility',
  pickaxe: 'pickaxe_default',
  glider: 'glider_default',
  emote: 'emote_wave',
  wrap: 'wrap_none',
  banner: 'banner_default',
  loading: 'loading_dawn',
};
export type EquippedMap = typeof DEFAULT_EQUIPPED;

export function outfitLook(id: string): OutfitLook {
  return (cosmetic(id)?.look ?? COSMETIC_BY_ID.get('outfit_recruit')!.look) as OutfitLook;
}
