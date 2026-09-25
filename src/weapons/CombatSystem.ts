import { Vector3 } from 'three';
import type { Rng } from '../core/rng';
import type { EventBus } from '../core/events';
import { MATERIAL_CAP, MAX_HEALTH, MAX_SHIELD } from '../core/constants';
import type { BuildSystem } from '../building/BuildSystem';
import type { GameEvents, DamageSource } from '../game/events';
import type { WorldState, ResourceNode } from '../game/WorldState';
import type { Combatant } from '../player/Combatant';
import { CONSUMABLES } from '../inventory/items';
import { PICKAXE, WEAPONS, damageFalloff, weaponStats } from './weapons';
import type { Collider } from '../physics/collision';

export type HitRegion = 'head' | 'body' | 'legs';

export interface CharacterHit {
  c: Combatant;
  t: number;
  region: HitRegion;
}

/** A floating practice target (training modes). */
export interface PracticeTarget {
  id: number;
  kind: 'static' | 'moving' | 'reaction';
  pos: Vector3;
  base: Vector3;
  radius: number;
  alive: boolean;
  respawnAt: number;
  phase: number;
  hitAt: number;
}

export interface CombatHost {
  time: number;
  rng: Rng;
  world: WorldState;
  builds: BuildSystem;
  events: EventBus<GameEvents>;
  combatants: Combatant[];
  targets: PracticeTarget[];
  applyDamage(target: Combatant, amount: number, attacker: Combatant | null, source: DamageSource, headshot: boolean, point: Vector3, weapon: string): void;
  onPracticeTargetHit(t: PracticeTarget, shooter: Combatant, amount: number, point: Vector3): void;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpDir = new Vector3();

/** Ray vs vertical cylinder (side only) → distance or -1. */
function rayCylinder(o: Vector3, d: Vector3, cx: number, cz: number, r: number, y0: number, y1: number, maxT: number): number {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) {
    // Vertical ray: inside the circle → hits the cap.
    if (ox * ox + oz * oz > r * r) return -1;
    const t = d.y > 0 ? (y0 - o.y) / d.y : (y1 - o.y) / d.y;
    return t >= 0 && t <= maxT ? t : -1;
  }
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t < 0 || t > maxT) continue;
    const y = o.y + d.y * t;
    if (y >= y0 && y <= y1) return t;
  }
  // Cap hit (looking down onto a crouched head, etc.)
  if (Math.abs(d.y) > 1e-6) {
    for (const cy of [y1, y0]) {
      const t = (cy - o.y) / d.y;
      if (t < 0 || t > maxT) continue;
      const x = ox + d.x * t;
      const z = oz + d.z * t;
      if (x * x + z * z <= r * r) return t;
    }
  }
  return -1;
}

function raySphere(o: Vector3, d: Vector3, cx: number, cy: number, cz: number, r: number, maxT: number): number {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t >= 0 && t <= maxT) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 >= 0 && t2 <= maxT ? t2 : -1;
}

/** Hitboxes: head sphere, torso cylinder (incl. arms), leg cylinder. */
export function rayCharacter(o: Vector3, d: Vector3, c: Combatant, maxT: number): { t: number; region: HitRegion } | null {
  const s = c.height / 1.8;
  const p = c.pos;
  let best = -1;
  let region: HitRegion = 'body';
  const head = raySphere(o, d, p.x, p.y + c.height - 0.2, p.z, 0.23, maxT);
  if (head >= 0) {
    best = head;
    region = 'head';
  }
  const torso = rayCylinder(o, d, p.x, p.z, 0.36, p.y + 0.85 * s, p.y + c.height - 0.42, maxT);
  if (torso >= 0 && (best < 0 || torso < best)) {
    best = torso;
    region = 'body';
  }
  const legs = rayCylinder(o, d, p.x, p.z, 0.27, p.y, p.y + 0.85 * s, maxT);
  if (legs >= 0 && (best < 0 || legs < best)) {
    best = legs;
    region = 'legs';
  }
  return best >= 0 ? { t: best, region } : null;
}

export class CombatSystem {
  constructor(private host: CombatHost) {}

  /** Nearest character hit along a ray, excluding `self` and dead players. */
  rayCharacters(o: Vector3, d: Vector3, maxT: number, self: Combatant | null): CharacterHit | null {
    let best: CharacterHit | null = null;
    for (const c of this.host.combatants) {
      if (c === self || !c.alive || c.air === 'bus') continue;
      // Cheap reject: distance from ray to character centre.
      tmpA.set(c.pos.x - o.x, c.pos.y + 0.9 - o.y, c.pos.z - o.z);
      const along = tmpA.dot(d);
      if (along < -1.5 || along > maxT + 1.5) continue;
      const perp2 = tmpA.lengthSq() - along * along;
      if (perp2 > 2.2 * 2.2) continue;
      const h = rayCharacter(o, d, c, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = { c, t: h.t, region: h.region };
    }
    return best;
  }

  private rayTargets(o: Vector3, d: Vector3, maxT: number): { target: PracticeTarget; t: number } | null {
    let best: { target: PracticeTarget; t: number } | null = null;
    for (const t of this.host.targets) {
      if (!t.alive) continue;
      const hit = raySphere(o, d, t.pos.x, t.pos.y, t.pos.z, t.radius, best ? best.t : maxT);
      if (hit >= 0) best = { target: t, t: hit };
    }
    return best;
  }

  /**
   * Where the crosshair is pointing. The camera ray is started at the
   * player's depth so objects between a third-person camera and the player
   * are ignored.
   */
  aimPoint(c: Combatant, range: number, out = new Vector3()): Vector3 {
    const i = c.input;
    const o = tmpA.set(i.rayOrigin.x, i.rayOrigin.y, i.rayOrigin.z);
    const d = tmpDir.set(i.rayDir.x, i.rayDir.y, i.rayDir.z).normalize();
    const eye = c.eye(tmpB);
    const t0 = Math.max(0, (eye.x - o.x) * d.x + (eye.y - o.y) * d.y + (eye.z - o.z) * d.z - 0.3);
    const start = new Vector3().copy(o).addScaledVector(d, t0);
    let t = range;
    const hit = this.host.world.collision.raycast(start, d, range, { bulletsOnly: true });
    if (hit) t = hit.t;
    const ch = this.rayCharacters(start, d, t, c);
    if (ch) t = ch.t;
    const tg = this.rayTargets(start, d, t);
    if (tg) t = tg.t;
    return out.copy(start).addScaledVector(d, Math.max(t, 1));
  }

  /** Per-tick weapon handling for one combatant. */
  update(c: Combatant, dt: number, fireHeld: boolean, prevFire: boolean): void {
    const inv = c.inventory;
    if (c.fireCooldown > 0) c.fireCooldown -= dt;
    if (c.switchTimer > 0) c.switchTimer -= dt;
    const w = inv.currentWeapon();
    if (w) {
      const def = WEAPONS[w.id];
      c.bloom = Math.max(0, c.bloom - def.bloomRecovery * dt * (fireHeld ? 0.25 : 1));
    } else c.bloom = 0;

    // Reload progression
    if (c.reloadTimer > 0) {
      if (inv.selected !== c.reloadSlot || !w) {
        c.reloadTimer = 0;
        c.reloadSlot = -1;
      } else {
        c.reloadTimer -= dt;
        if (c.reloadTimer <= 0) this.finishReloadStep(c);
      }
    }

    // Item usage
    if (c.useTimer > 0) {
      if (inv.selected !== c.useSlot) {
        c.useTimer = 0;
        c.useSlot = -1;
      } else {
        c.useTimer -= dt;
        if (c.useTimer <= 0) this.finishUse(c);
      }
    }

    if (c.buildPiece !== null || c.editingPieceId >= 0 || c.air !== 'none') return;
    if (!fireHeld) return;
    if (c.emoteTimer > 0) c.emoteTimer = 0;

    if (inv.selected === 'pickaxe') {
      if (c.fireCooldown <= 0) this.swingPickaxe(c);
      return;
    }
    const item = inv.current;
    if (!item) return;
    if (item.kind === 'consumable') {
      if (c.useTimer <= 0 && !prevFire) this.startUse(c);
      return;
    }
    const def = WEAPONS[item.id];
    if (c.switchTimer > 0 || c.fireCooldown > 0) return;
    if (c.reloadTimer > 0) {
      // Shell-by-shell reloads are interruptible by firing.
      if (def.reloadPerShell > 0 && item.ammoInMag > 0) {
        c.reloadTimer = 0;
        c.reloadSlot = -1;
      } else return;
    }
    if (item.ammoInMag <= 0) {
      this.startReload(c);
      return;
    }
    this.fire(c);
  }

  startReload(c: Combatant): boolean {
    const w = c.inventory.currentWeapon();
    if (!w || c.reloadTimer > 0) return false;
    const def = WEAPONS[w.id];
    if (w.ammoInMag >= def.magSize) return false;
    if (!c.unlimitedAmmo && c.inventory.ammo[def.ammo] <= 0) return false;
    const stats = weaponStats(w.id, w.rarity);
    c.reloadTimer = def.reloadPerShell > 0 ? stats.reloadPerShell : stats.reloadTime;
    c.reloadSlot = c.inventory.selected as number;
    this.host.events.emit('RELOAD_START', { combatantId: c.id, weapon: w.id });
    return true;
  }

  private finishReloadStep(c: Combatant): void {
    const w = c.inventory.currentWeapon();
    if (!w) return;
    const def = WEAPONS[w.id];
    const stats = weaponStats(w.id, w.rarity);
    const need = def.magSize - w.ammoInMag;
    const reserve = c.unlimitedAmmo ? Infinity : c.inventory.ammo[def.ammo];
    if (def.reloadPerShell > 0) {
      const add = Math.min(1, need, reserve);
      w.ammoInMag += add;
      if (!c.unlimitedAmmo) c.inventory.ammo[def.ammo] -= add;
      const reserveLeft = c.unlimitedAmmo ? Infinity : c.inventory.ammo[def.ammo];
      if (w.ammoInMag < def.magSize && reserveLeft > 0) {
        c.reloadTimer = stats.reloadPerShell;
        return;
      }
    } else {
      const add = Math.min(need, reserve);
      w.ammoInMag += add;
      if (!c.unlimitedAmmo) c.inventory.ammo[def.ammo] -= add;
    }
    c.reloadTimer = 0;
    c.reloadSlot = -1;
    this.host.events.emit('RELOAD_END', { combatantId: c.id, weapon: w.id });
  }

  private fire(c: Combatant): void {
    const w = c.inventory.currentWeapon()!;
    const def = WEAPONS[w.id];
    const stats = weaponStats(w.id, w.rarity);
    const host = this.host;
    w.ammoInMag -= 1;
    c.fireCooldown = stats.fireInterval;
    c.lastShotAt = host.time;
    c.stats.shotsFired++;
    const hSpeed = Math.hypot(c.vel.x, c.vel.z);
    let spread = (c.input.aim ? def.spreadAds : def.spreadHip) + def.spreadMoving * Math.min(1, hSpeed / 6) + c.bloom;
    if (c.crouching) spread *= 0.8;
    if (!c.grounded) spread += 0.015;
    spread *= stats.spreadMult;
    c.bloom = Math.min(def.bloomMax, c.bloom + def.bloomPerShot);

    const aim = this.aimPoint(c, def.range, new Vector3());
    const from = c.eye(new Vector3());
    const base = new Vector3().subVectors(aim, from).normalize();
    const perTarget = new Map<Combatant, { dmg: number; head: boolean; point: Vector3 }>();
    let firstEnd: Vector3 | null = null;
    let anyCharHit = false;
    for (let p = 0; p < def.pellets; p++) {
      const dir = perturb(base, spread, host.rng);
      const worldHit = host.world.collision.raycast(from, dir, def.range, { bulletsOnly: true });
      const maxT = worldHit ? worldHit.t : def.range;
      const ch = this.rayCharacters(from, dir, maxT, c);
      const tg = this.rayTargets(from, dir, ch ? ch.t : maxT);
      let end: Vector3;
      if (tg) {
        end = from.clone().addScaledVector(dir, tg.t);
        host.onPracticeTargetHit(tg.target, c, stats.damage * damageFalloff(def, tg.t), end);
        anyCharHit = true;
      } else if (ch) {
        end = from.clone().addScaledVector(dir, ch.t);
        const mult = ch.region === 'head' ? def.headMult : ch.region === 'legs' ? def.legMult : 1;
        const dmg = stats.damage * mult * damageFalloff(def, ch.t);
        const acc = perTarget.get(ch.c);
        if (acc) {
          acc.dmg += dmg;
          acc.head = acc.head || ch.region === 'head';
        } else perTarget.set(ch.c, { dmg, head: ch.region === 'head', point: end.clone() });
        anyCharHit = true;
      } else if (worldHit) {
        end = worldHit.point.clone();
        this.hitWorld(c, worldHit.collider, stats.damage * def.structureMult * damageFalloff(def, worldHit.t), end);
        host.events.emit('IMPACT', { point: end, normal: worldHit.normal, material: worldHit.terrain ? 'dirt' : (worldHit.collider?.material ?? 'concrete'), shooterId: c.id });
      } else {
        end = from.clone().addScaledVector(dir, def.range);
      }
      if (!firstEnd) firstEnd = end;
    }
    for (const [target, hit] of perTarget) {
      c.stats.shotsHit++;
      host.applyDamage(target, Math.round(hit.dmg), c, 'weapon', hit.head, hit.point, w.id);
    }
    c.recoilPitch += def.recoilPitch * (c.input.aim ? 0.6 : 1);
    c.recoilYaw += (host.rng.next() - 0.5) * 2 * def.recoilYaw;
    host.events.emit('SHOT_FIRED', { shooterId: c.id, weapon: w.id, from, to: firstEnd ?? aim, hitCharacter: anyCharHit });
    if (w.ammoInMag <= 0) this.startReload(c);
  }

  private hitWorld(c: Combatant, col: Collider | null, damage: number, point: Vector3): void {
    if (!col) return;
    if (col.owner === 'build') {
      this.host.builds.damage(col.ref, damage, c.id, point);
    }
  }

  private swingPickaxe(c: Combatant): void {
    const host = this.host;
    c.fireCooldown = PICKAXE.interval;
    c.lastSwingAt = host.time;
    host.events.emit('PICKAXE_SWING', { combatantId: c.id });
    const from = c.eye(new Vector3());
    const aim = this.aimPoint(c, 30, new Vector3());
    const dir = new Vector3().subVectors(aim, from).normalize();
    const range = PICKAXE.range;
    const worldHit = host.world.collision.raycast(from, dir, range, {});
    const maxT = worldHit ? worldHit.t : range;
    const ch = this.rayCharacters(from, dir, maxT, c);
    if (ch) {
      const point = from.clone().addScaledVector(dir, ch.t);
      host.applyDamage(ch.c, PICKAXE.damagePlayer, c, 'pickaxe', false, point, 'pickaxe');
      return;
    }
    const tg = this.rayTargets(from, dir, maxT);
    if (tg) {
      host.onPracticeTargetHit(tg.target, c, PICKAXE.damagePlayer, from.clone().addScaledVector(dir, tg.t));
      return;
    }
    if (!worldHit) return;
    const col = worldHit.collider;
    const point = worldHit.point;
    if (col?.owner === 'build') {
      host.builds.damage(col.ref, PICKAXE.damageBuild, c.id, point);
      host.events.emit('IMPACT', { point, normal: worldHit.normal, material: col.material, shooterId: c.id });
    } else if (col?.owner === 'resource') {
      const node = host.world.resourceFromCollider(col);
      if (node) this.harvest(c, node, point);
    } else {
      host.events.emit('IMPACT', { point, normal: worldHit.normal, material: worldHit.terrain ? 'dirt' : (col?.material ?? 'concrete'), shooterId: c.id });
    }
  }

  harvest(c: Combatant, node: ResourceNode, point: Vector3): void {
    if (!node.alive) return;
    const host = this.host;
    node.health -= PICKAXE.damageResource;
    node.hitAt = host.time;
    let amount = node.yieldPerHit;
    const destroyed = node.health <= 0;
    if (destroyed) {
      amount += Math.round(node.yieldPerHit * 1.5);
      host.world.destroyResource(node);
    }
    const before = c.materials[node.material];
    c.materials[node.material] = Math.min(MATERIAL_CAP, before + amount);
    const gained = c.materials[node.material] - before;
    c.stats.materialsGathered += gained;
    host.events.emit('RESOURCE_HIT', { combatantId: c.id, resourceId: node.id, amount: gained, material: node.material, point, destroyed });
  }

  private startUse(c: Combatant): void {
    const slot = c.inventory.selected;
    if (slot === 'pickaxe') return;
    const item = c.inventory.slots[slot];
    if (!item || item.kind !== 'consumable') return;
    const def = CONSUMABLES[item.id];
    const useful = (def.shield > 0 && c.shield < def.shieldCap) || (def.health > 0 && c.health < def.healthCap);
    if (!useful) {
      if (!c.isBot) this.host.events.emit('NOTICE', { text: def.shield > 0 ? 'Shield is already full' : 'Health is already full', kind: 'warn' });
      return;
    }
    c.useTimer = def.useTime;
    c.useSlot = slot;
    c.reloadTimer = 0;
  }

  private finishUse(c: Combatant): void {
    const slot = c.useSlot;
    c.useSlot = -1;
    c.useTimer = 0;
    if (slot < 0) return;
    const item = c.inventory.slots[slot];
    if (!item || item.kind !== 'consumable') return;
    const def = CONSUMABLES[item.id];
    if (def.shield > 0) c.shield = Math.min(MAX_SHIELD, Math.max(c.shield, Math.min(def.shieldCap, c.shield + def.shield)));
    if (def.health > 0) c.health = Math.min(MAX_HEALTH, Math.min(def.healthCap, c.health + def.health));
    c.inventory.consumeOne(slot);
    this.host.events.emit('ITEM_USED', { combatantId: c.id, itemId: def.id });
    this.host.events.emit('PLAYER_HEALED', { combatantId: c.id, health: c.health, shield: c.shield });
  }
}

/** Random direction within a cone of half-angle `spread` around `dir`. */
export function perturb(dir: Vector3, spread: number, rng: Rng): Vector3 {
  if (spread <= 0) return dir.clone();
  const up = Math.abs(dir.y) < 0.99 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const right = new Vector3().crossVectors(dir, up).normalize();
  const realUp = new Vector3().crossVectors(right, dir).normalize();
  const r = Math.sqrt(rng.next()) * Math.tan(spread);
  const a = rng.next() * Math.PI * 2;
  return dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(realUp, Math.sin(a) * r).normalize();
}
