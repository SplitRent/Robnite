import { Vector3 } from 'three';
import { TILE, TILE_H } from '../core/constants';
import { dirFromYawPitch, wrapAngle } from '../core/math';
import { computeBuildTarget, makeTarget, type BuildTarget } from '../building/targeting';
import { WALL_PRESETS } from '../building/edits';
import { CONSUMABLES, RARITY_INFO, type SlotItem } from '../inventory/items';
import { WEAPONS } from '../weapons/weapons';
import type { Combatant } from '../player/Combatant';
import type { Match } from '../game/Match';
import type { BotDifficulty } from '../game/matchTypes';
import type { GameAction } from '../networking/protocol';
import { BotGameAdapter } from '../networking/BotGameAdapter';

export type BotRole = 'fighter' | 'dummy';
export type BotState =
  | 'DROP'
  | 'LOOT'
  | 'TRAVEL'
  | 'SEARCH'
  | 'AIM'
  | 'ATTACK'
  | 'BUILD'
  | 'EDIT'
  | 'RETREAT'
  | 'HEAL'
  | 'ROTATE'
  | 'ESCAPE_STORM'
  | 'INVESTIGATE'
  | 'HARVEST'
  | 'IDLE';

interface DifficultyProfile {
  reaction: number;
  /** Aim error cone (radians) — re-rolled periodically. */
  aimError: number;
  /** Max aim turn speed (rad/s). */
  turnSpeed: number;
  buildChance: number;
  editChance: number;
  viewRange: number;
  headshotBias: number;
  strafe: number;
  fireTolerance: number;
}

export const DIFFICULTY: Record<BotDifficulty, DifficultyProfile> = {
  easy: { reaction: 0.8, aimError: 0.1, turnSpeed: 3.2, buildChance: 0.12, editChance: 0, viewRange: 55, headshotBias: 0, strafe: 0.25, fireTolerance: 0.12 },
  normal: { reaction: 0.5, aimError: 0.06, turnSpeed: 5.5, buildChance: 0.4, editChance: 0.05, viewRange: 85, headshotBias: 0.1, strafe: 0.5, fireTolerance: 0.09 },
  hard: { reaction: 0.32, aimError: 0.038, turnSpeed: 8, buildChance: 0.75, editChance: 0.25, viewRange: 115, headshotBias: 0.2, strafe: 0.75, fireTolerance: 0.07 },
  elite: { reaction: 0.2, aimError: 0.026, turnSpeed: 11, buildChance: 0.95, editChance: 0.5, viewRange: 140, headshotBias: 0.3, strafe: 0.95, fireTolerance: 0.055 },
};

const THINK_INTERVAL = 0.12;
const FOV_COS = Math.cos((65 * Math.PI) / 180);

/**
 * Bot AI. Perceives the world through simplified sensors (view cone + line of
 * sight + hearing), then produces the same PlayerInput and GameActions a
 * human would. It never reads hidden state such as enemies behind walls.
 */
export class BotBrain {
  state: BotState = 'IDLE';
  readonly profile: DifficultyProfile;
  readonly home = new Vector3();
  respawnAt = -1;
  private thinkTimer = Math.random() * THINK_INTERVAL;
  private moveTarget: Vector3 | null = null;
  private target: Combatant | null = null;
  private targetSeenAt = -99;
  private targetFirstSeenAt = -99;
  private lastSeenPos = new Vector3();
  private investigatePos: Vector3 | null = null;
  private investigateUntil = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private aimErr = new Vector3();
  private aimErrTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private landing: Vector3 | null = null;
  private dropAt = 0;
  private buildCooldown = 0;
  private editPieceId = -1;
  private editResetAt = 0;
  private stuckTimer = 0;
  private stuckCheckPos = new Vector3();
  private stuckCheckTime = 0;
  private detourUntil = 0;
  private detourYaw = 0;
  private jumpPulse = 0;
  private fireHold = false;
  private harvestGoal = -1;
  private underFireUntil = 0;
  private wanderTarget: Vector3 | null = null;
  private healPress = false;
  private goalKey = '';
  private goalSince = 0;
  private ignored = new Set<string>();
  /** The bot's connection to the simulation — same interface a human client uses. */
  readonly adapter: BotGameAdapter;

  constructor(
    private match: Match,
    readonly self: Combatant,
    difficulty: BotDifficulty,
    readonly role: BotRole,
  ) {
    this.profile = DIFFICULTY[difficulty];
    this.adapter = new BotGameAdapter(match, self.id);
    match.events.on('SHOT_FIRED', (e) => {
      if (e.shooterId === self.id || !self.alive) return;
      const d = Math.hypot(e.from.x - self.pos.x, e.from.z - self.pos.z);
      if (d < 75 && this.state !== 'ATTACK') {
        // Hearing is imprecise: jitter the heard position.
        const j = 4 + d * 0.12;
        this.investigatePos = new Vector3(e.from.x + (Math.random() - 0.5) * j, e.from.y, e.from.z + (Math.random() - 0.5) * j);
        this.investigateUntil = match.time + 8;
      }
    });
    match.events.on('PLAYER_DAMAGE', (e) => {
      if (e.targetId !== self.id || e.attackerId < 0) return;
      this.underFireUntil = match.time + 2;
      const attacker = match.byId(e.attackerId);
      if (attacker && !this.target) {
        // Being hit reveals roughly where it came from.
        this.investigatePos = attacker.pos.clone().add(new Vector3((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6));
        this.investigateUntil = match.time + 6;
      }
    });
  }

  private act(a: GameAction): void {
    this.adapter.sendAction(a);
  }

  update(dt: number): void {
    const c = this.self;
    const m = this.match;
    if (!c.alive) {
      if (this.role === 'dummy' && this.respawnAt > 0 && m.time >= this.respawnAt) {
        this.respawnAt = -1;
        m.respawn(c);
      }
      return;
    }
    if (this.role === 'dummy') {
      this.updateDummy(dt);
      return;
    }
    this.buildCooldown -= dt;
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = THINK_INTERVAL;
      this.think();
    }
    this.steer(dt);
  }

  // ---------------------------------------------------------------- dummy

  private updateDummy(dt: number): void {
    const c = this.self;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      this.strafeTimer = 0.6 + Math.random() * 1.2;
      this.jumpPulse = Math.random() < 0.25 ? 0.1 : 0;
    }
    const off = c.pos.x - this.home.x;
    if (Math.abs(off) > 4) this.strafeDir = off > 0 ? -1 : 1;
    this.jumpPulse -= dt;
    const i = c.input;
    i.yaw = 0;
    i.pitch = 0;
    i.forward = 0;
    i.right = this.strafeDir;
    i.jump = this.jumpPulse > 0;
    i.fire = false;
    i.sprint = false;
  }

  // ---------------------------------------------------------------- perception

  private canSee(other: Combatant): boolean {
    const c = this.self;
    const eye = c.eye(new Vector3());
    const chest = other.chest(new Vector3());
    const to = new Vector3().subVectors(chest, eye);
    const dist = to.length();
    if (dist > this.profile.viewRange) return false;
    to.divideScalar(dist);
    const look = dirFromYawPitch(c.yaw, 0, new Vector3());
    const facing = to.x * look.x + to.z * look.z;
    // Outside the view cone only very close movement is noticed.
    if (facing < FOV_COS && dist > 10) return false;
    return this.match.world.collision.lineOfSight(eye, chest);
  }

  private perceive(): void {
    const m = this.match;
    const c = this.self;
    let best: Combatant | null = null;
    let bestD = Infinity;
    for (const o of m.combatants) {
      if (o === c || !o.alive || o.air === 'bus' || o.teamId === c.teamId) continue;
      const d = o.pos.distanceTo(c.pos);
      if (d > this.profile.viewRange || d >= bestD) continue;
      // Keep tracking a current target more eagerly.
      if (this.canSee(o)) {
        best = o;
        bestD = d;
      }
    }
    if (best) {
      if (this.target !== best) this.targetFirstSeenAt = m.time;
      this.target = best;
      this.targetSeenAt = m.time;
      this.lastSeenPos.copy(best.pos);
    } else if (this.target && (!this.target.alive || m.time - this.targetSeenAt > 6)) {
      this.target = null;
    }
  }

  // ---------------------------------------------------------------- decisions

  private think(): void {
    const m = this.match;
    const c = this.self;
    if (c.air === 'bus') {
      this.state = 'DROP';
      this.planDrop();
      if (m.phase === 'DEPLOYMENT' && m.bus && m.bus.t >= this.dropAt) this.act({ type: 'jumpFromBus' });
      return;
    }
    if (c.air !== 'none') {
      this.state = 'DROP';
      this.moveTarget = this.landing;
      return;
    }
    if (m.phase === 'WARMUP' || m.phase === 'ROUND_END') {
      this.state = 'IDLE';
      this.moveTarget = null;
      return;
    }
    this.perceive();
    this.checkStuck();
    this.handleEditReset();
    const visible = this.target && m.time - this.targetSeenAt < 0.35;
    const hp = c.health + c.shield;
    const storm = m.storm;

    // 1. Storm
    if (storm && !storm.isInside(c.pos.x, c.pos.z)) {
      this.state = 'ESCAPE_STORM';
      this.moveTarget = new Vector3(storm.centerX, 0, storm.centerZ);
      if (visible && this.target!.pos.distanceTo(c.pos) < 25) this.fightTarget();
      else this.fireHold = false;
      return;
    }
    // 2. Heal when hurt and not in immediate danger
    const heal = this.bestHealSlot();
    if (heal >= 0 && hp < 110 && (!visible || this.target!.pos.distanceTo(c.pos) > 35) && m.time > this.underFireUntil - 1) {
      this.state = 'HEAL';
      this.moveTarget = null;
      if (this.profile.buildChance > 0.5 && this.buildCooldown <= 0 && c.totalMaterials >= 50 && m.time < this.underFireUntil + 3) this.buildBox();
      if (c.inventory.selected !== heal) this.act({ type: 'selectSlot', slot: heal });
      else if (c.useTimer <= 0) this.healPress = true;
      return;
    }
    // 3. Fight (unarmed bots prefer grabbing loot over a pickaxe brawl)
    const armed = c.inventory.weapons().some((w) => w.ammoInMag > 0 || c.unlimitedAmmo || c.inventory.ammo[WEAPONS[w.id].ammo] > 0);
    if (visible && !armed && m.mode.loot) {
      const d = this.target!.pos.distanceTo(c.pos);
      if (d > 2.5 && m.time > this.underFireUntil) {
        if (this.planLoot()) return;
        this.state = 'RETREAT';
        const away = new Vector3().subVectors(c.pos, this.target!.pos).setY(0).normalize().multiplyScalar(20);
        this.moveTarget = c.pos.clone().add(away);
        this.fireHold = false;
        return;
      }
    }
    if (visible) {
      if (hp < 45 && c.inventory.weapons().length > 0 && Math.random() < 0.3) {
        this.state = 'RETREAT';
        const away = new Vector3().subVectors(c.pos, this.target!.pos).setY(0).normalize().multiplyScalar(25);
        this.moveTarget = c.pos.clone().add(away);
        if (this.buildCooldown <= 0 && Math.random() < this.profile.buildChance) this.buildBox();
        this.fightTarget();
        return;
      }
      this.fightTarget();
      return;
    }
    this.fireHold = false;
    // 4. Search last seen position
    if (this.target && m.time - this.targetSeenAt < 6) {
      this.state = 'SEARCH';
      this.moveTarget = this.lastSeenPos.clone();
      this.equipBest(this.lastSeenPos.distanceTo(c.pos));
      return;
    }
    // 5. Storm rotation ahead of time
    if (storm && storm.stage === 'wait' && storm.timer < 20) {
      const dn = Math.hypot(c.pos.x - storm.nextX, c.pos.z - storm.nextZ);
      if (dn > storm.nextRadius * 0.8) {
        this.state = 'ROTATE';
        this.moveTarget = new Vector3(storm.nextX, 0, storm.nextZ);
        return;
      }
    }
    // 6. Investigate sounds. In small arena modes the rough direction of the
    // opponent is common knowledge (with plenty of positional error).
    if (m.isRoundMode && (!this.investigatePos || m.time > this.investigateUntil)) {
      const enemy = m.combatants.find((o) => o !== c && o.alive && o.teamId !== c.teamId);
      if (enemy) {
        this.investigatePos = enemy.pos.clone().add(new Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));
        this.investigateUntil = m.time + 4;
      }
    }
    if (this.investigatePos && m.time < this.investigateUntil) {
      this.state = 'INVESTIGATE';
      this.moveTarget = this.investigatePos;
      if (this.investigatePos.distanceTo(c.pos) < 4) this.investigatePos = null;
      this.equipBest(30);
      return;
    }
    // 7. Loot
    if (m.mode.loot && this.planLoot()) return;
    // 8. Harvest if low on materials
    if (c.totalMaterials < 120 && !c.unlimitedMaterials && this.planHarvest()) return;
    // 9. Travel / wander
    this.state = 'TRAVEL';
    if (!this.wanderTarget || this.wanderTarget.distanceTo(c.pos) < 6) this.wanderTarget = this.pickWander();
    this.moveTarget = this.wanderTarget;
    this.equipBest(40);
  }

  private pickWander(): Vector3 {
    const m = this.match;
    const s = m.storm;
    const cx = s ? s.stage === 'wait' ? s.nextX : s.centerX : 0;
    const cz = s ? s.stage === 'wait' ? s.nextZ : s.centerZ : 0;
    const r = s ? Math.max(8, (s.stage === 'wait' ? s.nextRadius : s.radius) * 0.7) : m.world.map.half * 0.6;
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r;
    return new Vector3(cx + Math.cos(a) * d, 0, cz + Math.sin(a) * d);
  }

  private planDrop(): void {
    if (this.landing) return;
    const m = this.match;
    const pois = m.world.map.pois;
    const choice = pois.length && Math.random() < 0.8 ? pois[Math.floor(Math.random() * pois.length)] : null;
    const weighted = pois.length ? pois.reduce((a, p) => (Math.random() * p.lootValue > Math.random() * a.lootValue ? p : a), pois[0]) : null;
    const p = Math.random() < 0.35 ? null : Math.random() < 0.5 ? weighted : choice;
    if (p) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * p.radius * 0.6;
      this.landing = new Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r);
    } else {
      const s = m.world.map.lootSpots[Math.floor(Math.random() * m.world.map.lootSpots.length)];
      this.landing = new Vector3(s[0], 0, s[2]);
    }
    const bus = m.bus!;
    const along = new Vector3().subVectors(this.landing, bus.start).dot(bus.dir);
    const total = bus.start.distanceTo(bus.end);
    const jumpDist = Math.max(0, Math.min(total * 0.95, along - 55 - Math.random() * 25));
    this.dropAt = (jumpDist / total) * bus.duration;
  }

  private fightTarget(): void {
    const c = this.self;
    const t = this.target!;
    const m = this.match;
    const dist = t.pos.distanceTo(c.pos);
    this.state = 'ATTACK';
    this.equipBest(dist);
    // Movement: approach to a preferred range while strafing.
    const w = c.inventory.currentWeapon();
    const pref = !w ? 1.5 : w.id === 'shotgun' ? 5 : w.id === 'smg' ? 12 : w.id === 'marksman' ? 60 : 25;
    const to = new Vector3().subVectors(t.pos, c.pos).setY(0);
    const len = to.length() || 1;
    to.divideScalar(len);
    const side = new Vector3(-to.z, 0, to.x).multiplyScalar(this.strafeDir * this.profile.strafe * 6);
    const goal = c.pos.clone();
    if (dist > pref * 1.3) goal.addScaledVector(to, 8);
    else if (dist < pref * 0.6) goal.addScaledVector(to, -5);
    goal.add(side);
    this.moveTarget = goal;

    const reacted = m.time - this.targetFirstSeenAt > this.profile.reaction;
    this.fireHold = reacted && !!w && (w.ammoInMag > 0 || w.id === 'shotgun');
    if (!w) {
      this.fireHold = dist < 3; // pickaxe
      this.moveTarget = t.pos.clone();
    }
    // Defensive / aggressive building
    if (this.buildCooldown <= 0 && !c.unlimitedMaterials && c.totalMaterials < 20) return;
    if (this.buildCooldown <= 0 && Math.random() < this.profile.buildChance * 0.5) {
      if (m.time < this.underFireUntil) this.buildWallToward(t.pos);
      else if (t.pos.y > c.pos.y + 2 && Math.random() < this.profile.buildChance) this.buildRamp();
      else if (this.profile.buildChance > 0.7 && dist < 30 && Math.random() < 0.3) this.buildRamp();
    }
    // Edit peeks from own box
    if (this.editPieceId < 0 && Math.random() < this.profile.editChance * 0.2) this.tryEditPeek(t);
  }

  private equipBest(dist: number): void {
    const c = this.self;
    const inv = c.inventory;
    if (c.buildPiece !== null || c.useTimer > 0) return;
    let bestSlot = -1;
    let bestScore = -1;
    inv.slots.forEach((s, i) => {
      if (!s || s.kind !== 'weapon') return;
      const hasAmmo = s.ammoInMag > 0 || c.unlimitedAmmo || inv.ammo[WEAPONS[s.id].ammo] > 0;
      if (!hasAmmo) return;
      let score = RARITY_INFO[s.rarity].tier * 0.3;
      if (s.id === 'shotgun') score += dist < 9 ? 5 : dist < 15 ? 2 : 0;
      if (s.id === 'smg') score += dist < 20 ? 3.5 : 1;
      if (s.id === 'ar') score += dist < 80 ? 3 : 2;
      if (s.id === 'marksman') score += dist > 60 ? 4.5 : 0.5;
      if (score > bestScore) {
        bestScore = score;
        bestSlot = i;
      }
    });
    if (bestSlot >= 0 && inv.selected !== bestSlot) this.act({ type: 'selectSlot', slot: bestSlot });
    else if (bestSlot < 0 && inv.selected !== 'pickaxe') this.act({ type: 'selectPickaxe' });
  }

  private bestHealSlot(): number {
    const c = this.self;
    let best = -1;
    c.inventory.slots.forEach((s, i) => {
      if (!s || s.kind !== 'consumable') return;
      const d = CONSUMABLES[s.id];
      if ((d.shield > 0 && c.shield < d.shieldCap - 5) || (d.health > 0 && c.health < 70)) best = i;
    });
    return best;
  }

  // ---------------------------------------------------------------- looting

  private itemScore(it: SlotItem | { kind: 'ammo' | 'material' }): number {
    const c = this.self;
    const inv = c.inventory;
    if (it.kind === 'weapon') {
      const have = inv.weapons().find((w) => w.id === it.id);
      if (have && RARITY_INFO[have.rarity].tier >= RARITY_INFO[it.rarity].tier) return 0;
      if (!have && inv.firstEmpty() < 0) return 0;
      return 10 + RARITY_INFO[it.rarity].tier * 2 + (inv.weapons().length === 0 ? 20 : 0);
    }
    if (it.kind === 'consumable') return inv.hasRoomFor(it) ? 5 : 0;
    if (it.kind === 'ammo') return inv.weapons().length ? 3 : 0.5;
    return c.totalMaterials < 400 ? 3 : 0;
  }

  private planLoot(): boolean {
    const m = this.match;
    const c = this.self;
    let bestScore = 0;
    let best: { kind: 'item' | 'chest'; id: number; pos: Vector3 } | null = null;
    for (const g of m.world.items.values()) {
      const d = g.pos.distanceTo(c.pos);
      if (d > 45 || this.ignored.has(`i${g.id}`) || g.pos.y - c.pos.y > 4.5) continue;
      const s = this.itemScore(g.item as SlotItem) / (1 + d / 12);
      if (s > bestScore) {
        bestScore = s;
        best = { kind: 'item', id: g.id, pos: g.pos };
      }
    }
    for (const ch of m.world.chests) {
      if (ch.opened) continue;
      const pos = new Vector3(ch.spec.x, ch.spec.y, ch.spec.z);
      const d = pos.distanceTo(c.pos);
      if (d > 45 || this.ignored.has(`c${ch.id}`) || pos.y - c.pos.y > 4.5) continue;
      const s = (c.inventory.weapons().length < 3 ? 14 : 6) / (1 + d / 12);
      if (s > bestScore) {
        bestScore = s;
        best = { kind: 'chest', id: ch.id, pos };
      }
    }
    if (!best || bestScore < 0.4) {
      return false;
    }
    // Give up on goals we can't reach (on rooftops, behind walls...).
    const key = `${best.kind === 'item' ? 'i' : 'c'}${best.id}`;
    if (key !== this.goalKey) {
      this.goalKey = key;
      this.goalSince = m.time;
    } else if (m.time - this.goalSince > 9) {
      this.ignored.add(key);
      this.goalKey = '';
      return false;
    }
    this.state = 'LOOT';
    this.moveTarget = best.pos.clone();
    const flat = Math.hypot(best.pos.x - c.pos.x, best.pos.z - c.pos.z);
    if (flat < 2.2 && Math.abs(best.pos.y - c.pos.y) < 2.5) {
      // Same interaction path as a player: look at it and press interact
      // (only when the thing under our "crosshair" is the item we want).
      const under = m.findInteractable(c);
      if (under && under.kind === best.kind && under.id === best.id) this.act({ type: 'interact' });
      this.equipBest(30);
    }
    return true;
  }

  private planHarvest(): boolean {
    const m = this.match;
    const c = this.self;
    let best = -1;
    let bestD = 30;
    for (const r of m.world.resources) {
      if (!r.alive) continue;
      const d = Math.hypot(r.spec.x - c.pos.x, r.spec.z - c.pos.z);
      if (d < bestD) {
        bestD = d;
        best = r.id;
      }
    }
    if (best < 0) return false;
    this.state = 'HARVEST';
    this.harvestGoal = best;
    const r = m.world.resources[best];
    this.moveTarget = new Vector3(r.spec.x, r.spec.y, r.spec.z);
    if (c.inventory.selected !== 'pickaxe') this.act({ type: 'selectPickaxe' });
    return true;
  }

  // ---------------------------------------------------------------- building

  private cellOf(p: Vector3): { x: number; y: number; z: number } {
    return { x: Math.floor(p.x / TILE), y: Math.floor((p.y + 0.3) / TILE_H), z: Math.floor(p.z / TILE) };
  }

  private placeTargets(piece: 'wall' | 'floor' | 'ramp' | 'cone', targets: BuildTarget[]): void {
    const c = this.self;
    let placed = 0;
    this.act({ type: 'selectBuild', piece });
    for (const t of targets) {
      if (t.piece !== piece) {
        this.act({ type: 'selectBuild', piece: t.piece });
        piece = t.piece;
      }
      if (this.match.builds.validate(t, c).valid) {
        this.act({ type: 'place', target: t });
        placed++;
      }
    }
    this.act({ type: 'exitBuild' });
    this.buildCooldown = placed > 0 ? 1.4 - this.profile.buildChance * 0.8 : 0.5;
    if (placed) this.state = 'BUILD';
  }

  private buildWallToward(p: Vector3): void {
    const c = this.self;
    const g = this.cellOf(c.pos);
    const dx = p.x - c.pos.x;
    const dz = p.z - c.pos.z;
    const t = Math.abs(dx) > Math.abs(dz)
      ? makeTarget('wall', { x: g.x + (dx > 0 ? 1 : 0), y: g.y, z: g.z }, 0)
      : makeTarget('wall', { x: g.x, y: g.y, z: g.z + (dz > 0 ? 1 : 0) }, 1);
    this.placeTargets('wall', [t]);
  }

  private buildBox(): void {
    const g = this.cellOf(this.self.pos);
    this.placeTargets('wall', [
      makeTarget('wall', { x: g.x, y: g.y, z: g.z }, 0),
      makeTarget('wall', { x: g.x + 1, y: g.y, z: g.z }, 0),
      makeTarget('wall', { x: g.x, y: g.y, z: g.z }, 1),
      makeTarget('wall', { x: g.x, y: g.y, z: g.z + 1 }, 1),
      makeTarget('cone', { x: g.x, y: g.y + 1, z: g.z }, 0),
    ]);
  }

  /** Ramps use the same crosshair targeting as players (a synthetic look ray). */
  private buildRamp(): void {
    const c = this.self;
    const eye = c.eye(new Vector3());
    const dir = dirFromYawPitch(this.aimYaw, -0.55, new Vector3());
    const t = computeBuildTarget(this.match.world.collision, {
      origin: eye,
      dir,
      eye,
      piece: 'ramp',
      userRotation: 0,
      pieceInfo: (id) => {
        const p = this.match.builds.pieces.get(id);
        return p ? { type: p.type, grid: p.grid, rotation: p.rampDir } : null;
      },
    });
    this.placeTargets('ramp', [t]);
  }

  private tryEditPeek(enemy: Combatant): void {
    const c = this.self;
    const g = this.cellOf(c.pos);
    const dx = enemy.pos.x - c.pos.x;
    const dz = enemy.pos.z - c.pos.z;
    const t = Math.abs(dx) > Math.abs(dz)
      ? makeTarget('wall', { x: g.x + (dx > 0 ? 1 : 0), y: g.y, z: g.z }, 0)
      : makeTarget('wall', { x: g.x, y: g.y, z: g.z + (dz > 0 ? 1 : 0) }, 1);
    const piece = this.match.builds.pieceByKey(t.key);
    if (!piece || piece.ownerId !== c.id || this.match.builds.isEdited(piece)) return;
    this.state = 'EDIT';
    this.act({ type: 'edit', pieceId: piece.id, mask: WALL_PRESETS.window });
    this.editPieceId = piece.id;
    this.editResetAt = this.match.time + 1.6;
  }

  private handleEditReset(): void {
    if (this.editPieceId >= 0 && this.match.time > this.editResetAt) {
      this.act({ type: 'resetEdit', pieceId: this.editPieceId });
      this.editPieceId = -1;
    }
  }

  // ---------------------------------------------------------------- movement / aim

  private checkStuck(): void {
    const m = this.match;
    const c = this.self;
    if (m.time - this.stuckCheckTime < 1.2) return;
    const moved = c.pos.distanceTo(this.stuckCheckPos);
    const tryingToMove = this.moveTarget && Math.hypot(this.moveTarget.x - c.pos.x, this.moveTarget.z - c.pos.z) > 3;
    if (tryingToMove && moved < 0.6) {
      this.stuckTimer += m.time - this.stuckCheckTime;
      this.detourUntil = m.time + 1.1;
      this.detourYaw = c.yaw + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random());
      this.jumpPulse = 0.15;
      if (this.stuckTimer > 4) {
        this.wanderTarget = this.pickWander();
        if (this.state === 'LOOT' || this.state === 'HARVEST') this.investigatePos = null;
        this.stuckTimer = 0;
      }
    } else this.stuckTimer = Math.max(0, this.stuckTimer - 1);
    this.stuckCheckPos.copy(c.pos);
    this.stuckCheckTime = m.time;
  }

  private steer(dt: number): void {
    const c = this.self;
    const m = this.match;
    const input = c.input;
    input.jump = false;
    input.fire = false;
    input.crouch = false;
    input.aim = false;
    input.sprint = false;
    input.forward = 0;
    input.right = 0;

    // Desired look direction
    let lookYaw = this.aimYaw;
    let lookPitch = 0;
    const t = this.target;
    const engaging = t && t.alive && (this.state === 'ATTACK' || this.state === 'RETREAT' || this.state === 'ESCAPE_STORM') && m.time - this.targetSeenAt < 0.6;
    if (engaging) {
      this.aimErrTimer -= dt;
      const dist = t!.pos.distanceTo(c.pos);
      if (this.aimErrTimer <= 0) {
        this.aimErrTimer = 0.35 + Math.random() * 0.3;
        const e = this.profile.aimError * dist;
        this.aimErr.set((Math.random() - 0.5) * 2 * e, (Math.random() - 0.5) * 1.6 * e, (Math.random() - 0.5) * 2 * e);
      }
      const w = c.inventory.currentWeapon();
      const travel = w?.id === 'marksman' ? dist / 400 : 0.06;
      const aimAt = t!.pos.clone().addScaledVector(t!.vel, travel + this.profile.reaction * 0.2);
      aimAt.y += Math.random() < this.profile.headshotBias ? t!.height - 0.2 : t!.height * 0.62;
      aimAt.add(this.aimErr);
      const eye = c.eye(new Vector3());
      const d = aimAt.sub(eye);
      lookYaw = Math.atan2(-d.x, -d.z);
      lookPitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    } else if (this.moveTarget) {
      const d = new Vector3().subVectors(this.moveTarget, c.pos);
      if (Math.hypot(d.x, d.z) > 0.5) lookYaw = Math.atan2(-d.x, -d.z);
      if (this.state === 'HARVEST') {
        const r = m.world.resources[this.harvestGoal];
        if (r) lookPitch = Math.atan2(r.spec.y + 1 - (c.pos.y + c.eyeHeight), Math.max(0.5, Math.hypot(d.x, d.z)));
      } else if (this.state === 'LOOT') {
        lookPitch = Math.atan2(this.moveTarget.y + 0.3 - (c.pos.y + c.eyeHeight), Math.max(0.5, Math.hypot(d.x, d.z)));
      }
    }
    if (this.detourUntil > m.time && !engaging) lookYaw = this.detourYaw;

    // Recoil kicks the view; the aim controller has to pull it back.
    this.aimPitch += c.recoilPitch * 0.8;
    this.aimYaw += c.recoilYaw * 0.8;
    c.recoilPitch = 0;
    c.recoilYaw = 0;
    const maxTurn = (engaging ? this.profile.turnSpeed : 7) * dt;
    this.aimYaw += Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(lookYaw - this.aimYaw)));
    this.aimPitch += Math.max(-maxTurn, Math.min(maxTurn, lookPitch - this.aimPitch));
    this.aimPitch = Math.max(-1.4, Math.min(1.4, this.aimPitch));
    input.yaw = this.aimYaw;
    input.pitch = this.aimPitch;
    const eye = c.eye(new Vector3());
    input.rayOrigin = { x: eye.x, y: eye.y, z: eye.z };
    const dir = dirFromYawPitch(this.aimYaw, this.aimPitch, new Vector3());
    input.rayDir = { x: dir.x, y: dir.y, z: dir.z };

    // Movement toward moveTarget (independent of look direction)
    if (this.moveTarget || (this.detourUntil > m.time)) {
      let mx: number;
      let mz: number;
      if (this.detourUntil > m.time) {
        mx = -Math.sin(this.detourYaw);
        mz = -Math.cos(this.detourYaw);
      } else {
        mx = this.moveTarget!.x - c.pos.x;
        mz = this.moveTarget!.z - c.pos.z;
      }
      const len = Math.hypot(mx, mz);
      const arrive = this.detourUntil > m.time ? 0 : this.state === 'ATTACK' ? 0.2 : 1.2;
      if (len > arrive) {
        mx /= len;
        mz /= len;
        const fx = -Math.sin(this.aimYaw);
        const fz = -Math.cos(this.aimYaw);
        const rx = Math.cos(this.aimYaw);
        const rz = -Math.sin(this.aimYaw);
        input.forward = mx * fx + mz * fz;
        input.right = mx * rx + mz * rz;
        input.sprint = !engaging && input.forward > 0.5;
        // Obstacle probe: jump over low obstacles.
        if (c.grounded && c.air === 'none') {
          const probe = new Vector3(c.pos.x, c.pos.y + 0.45, c.pos.z);
          const pd = new Vector3(mx, 0, mz);
          const hit = m.world.collision.raycast(probe, pd, 1.2, { includeTerrain: false });
          if (hit) {
            const door = m.world.doorFromCollider(hit.collider);
            if (door && !door.open) this.act({ type: 'interact' });
            else {
              const high = m.world.collision.raycast(new Vector3(c.pos.x, c.pos.y + 1.5, c.pos.z), pd, 1.4, { includeTerrain: false });
              if (!high) this.jumpPulse = 0.12;
              else if (hit.collider?.owner === 'build') {
                const piece = m.builds.pieceFromCollider(hit.collider);
                // Break through enemy builds with the pickaxe or weapon.
                if (piece && piece.ownerId !== c.id && !engaging) {
                  this.aimYaw = Math.atan2(-mx, -mz);
                  input.fire = true;
                } else if (piece && piece.ownerId === c.id && piece.type === 'wall' && !m.builds.isEdited(piece)) {
                  // Edit an opening through our own wall instead of getting stuck.
                  this.act({ type: 'edit', pieceId: piece.id, mask: WALL_PRESETS.largeOpening });
                }
              }
            }
          }
        }
      }
    }
    // Air steering
    if (c.air === 'skydive' || c.air === 'glide') {
      if (this.landing) {
        const d = Math.hypot(this.landing.x - c.pos.x, this.landing.z - c.pos.z);
        input.yaw = Math.atan2(-(this.landing.x - c.pos.x), -(this.landing.z - c.pos.z));
        this.aimYaw = input.yaw;
        input.forward = d > 6 ? 1 : 0;
        input.right = 0;
        input.pitch = -0.6;
      }
      return;
    }

    if (engaging) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 0.5 + Math.random() * 1.2;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        if (Math.random() < this.profile.strafe * 0.35) this.jumpPulse = 0.1;
      }
      const w = c.inventory.currentWeapon();
      input.aim = !!w && w.id !== 'shotgun' && t!.pos.distanceTo(c.pos) > 15;
      const err = Math.abs(wrapAngle(lookYaw - this.aimYaw)) + Math.abs(lookPitch - this.aimPitch);
      input.fire = this.fireHold && err < this.profile.fireTolerance + (w?.id === 'shotgun' ? 0.08 : 0);
      if (w && w.ammoInMag === 0 && c.reloadTimer <= 0) this.act({ type: 'reload' });
    } else if (this.state === 'HARVEST') {
      const r = m.world.resources[this.harvestGoal];
      if (r && r.alive && Math.hypot(r.spec.x - c.pos.x, r.spec.z - c.pos.z) < 2.6) {
        input.forward = 0;
        input.right = 0;
        input.fire = true;
      }
    } else {
      // Reload when safe
      const w = c.inventory.currentWeapon();
      if (w && w.ammoInMag < WEAPONS[w.id].magSize * 0.5 && c.reloadTimer <= 0 && Math.random() < 0.02) this.act({ type: 'reload' });
    }
    if (this.healPress) {
      input.fire = true;
      input.forward = 0;
      input.right = 0;
      this.healPress = false;
    }
    if (this.jumpPulse > 0) {
      this.jumpPulse -= dt;
      input.jump = true;
    }
    this.adapter.sendInput(input);
  }

  /** Debug label. */
  describe(): string {
    return `${this.self.name}: ${this.state}${this.target ? ` → ${this.target.name}` : ''}`;
  }
}
