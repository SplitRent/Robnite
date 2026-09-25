import { RARITY_INFO, registerWeaponNames, type AmmoType, type Rarity, type WeaponId } from '../inventory/items';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  ammo: AmmoType;
  damage: number;
  pellets: number;
  headMult: number;
  legMult: number;
  /** Seconds between shots. */
  fireInterval: number;
  automatic: boolean;
  magSize: number;
  reloadTime: number;
  /** Shell-by-shell reload (seconds per shell); interruptible by firing. */
  reloadPerShell: number;
  /** Spread cone half-angle in radians. */
  spreadHip: number;
  spreadAds: number;
  spreadMoving: number;
  bloomPerShot: number;
  bloomMax: number;
  bloomRecovery: number;
  range: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  recoilPitch: number;
  recoilYaw: number;
  adsFov: number;
  scoped: boolean;
  /** Multiplier applied to structure damage. */
  structureMult: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar: {
    id: 'ar', name: 'Vanguard Rifle', short: 'RIFLE', ammo: 'medium', damage: 31, pellets: 1, headMult: 1.75, legMult: 0.75,
    fireInterval: 1 / 5.5, automatic: true, magSize: 30, reloadTime: 2.2, reloadPerShell: 0,
    spreadHip: 0.028, spreadAds: 0.006, spreadMoving: 0.02, bloomPerShot: 0.006, bloomMax: 0.05, bloomRecovery: 0.12,
    range: 250, falloffStart: 60, falloffEnd: 150, falloffMin: 0.7, recoilPitch: 0.011, recoilYaw: 0.004, adsFov: 0.75, scoped: false, structureMult: 1,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', short: 'SMG', ammo: 'light', damage: 16, pellets: 1, headMult: 1.75, legMult: 0.75,
    fireInterval: 1 / 12, automatic: true, magSize: 30, reloadTime: 1.8, reloadPerShell: 0,
    spreadHip: 0.04, spreadAds: 0.022, spreadMoving: 0.015, bloomPerShot: 0.004, bloomMax: 0.05, bloomRecovery: 0.2,
    range: 120, falloffStart: 18, falloffEnd: 60, falloffMin: 0.55, recoilPitch: 0.006, recoilYaw: 0.004, adsFov: 0.85, scoped: false, structureMult: 1,
  },
  shotgun: {
    id: 'shotgun', name: 'Breaker Pump', short: 'PUMP', ammo: 'shells', damage: 11, pellets: 9, headMult: 1.75, legMult: 0.8,
    fireInterval: 0.85, automatic: false, magSize: 5, reloadTime: 0, reloadPerShell: 0.55,
    spreadHip: 0.075, spreadAds: 0.06, spreadMoving: 0.01, bloomPerShot: 0, bloomMax: 0, bloomRecovery: 1,
    range: 45, falloffStart: 7, falloffEnd: 25, falloffMin: 0.25, recoilPitch: 0.05, recoilYaw: 0.01, adsFov: 0.9, scoped: false, structureMult: 0.8,
  },
  marksman: {
    id: 'marksman', name: 'Longwatch DMR', short: 'DMR', ammo: 'heavy', damage: 98, pellets: 1, headMult: 1.75, legMult: 0.75,
    fireInterval: 1.15, automatic: false, magSize: 4, reloadTime: 2.6, reloadPerShell: 0,
    spreadHip: 0.05, spreadAds: 0.0006, spreadMoving: 0.03, bloomPerShot: 0, bloomMax: 0, bloomRecovery: 1,
    range: 400, falloffStart: 400, falloffEnd: 500, falloffMin: 1, recoilPitch: 0.06, recoilYaw: 0.006, adsFov: 0.3, scoped: true, structureMult: 1.2,
  },
};

registerWeaponNames((id) => WEAPONS[id].name);

export const PICKAXE = {
  damagePlayer: 20,
  damageBuild: 50,
  damageResource: 50,
  interval: 0.55,
  range: 2.8,
};

export interface WeaponStats {
  damage: number;
  fireInterval: number;
  reloadTime: number;
  reloadPerShell: number;
  magSize: number;
  spreadMult: number;
}

/** Rarity scaling: modest, readable improvements per tier. */
export function weaponStats(id: WeaponId, rarity: Rarity): WeaponStats {
  const def = WEAPONS[id];
  const tier = RARITY_INFO[rarity].tier;
  return {
    damage: def.damage * (1 + 0.055 * tier),
    fireInterval: def.fireInterval * (1 - 0.02 * tier),
    reloadTime: def.reloadTime * (1 - 0.05 * tier),
    reloadPerShell: def.reloadPerShell * (1 - 0.05 * tier),
    magSize: def.magSize,
    spreadMult: 1 - 0.04 * tier,
  };
}

export function damageFalloff(def: WeaponDef, dist: number): number {
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.falloffMin;
  const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 - (1 - def.falloffMin) * t;
}
