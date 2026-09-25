import { Vector3 } from 'three';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { FALL_DAMAGE_PER_MS, FALL_DAMAGE_SPEED, INTERACT_RANGE, MATERIAL_CAP, MAX_SHIELD, SIM_DT, TILE, TILE_H } from '../core/constants';
import { logger } from '../core/log';
import { BuildSystem } from '../building/BuildSystem';
import { makeTarget } from '../building/targeting';
import { WALL_PRESETS } from '../building/edits';
import type { BuildPieceType } from '../building/grid';
import { BUILD_MATERIALS } from '../building/grid';
import { CombatSystem, type CombatHost, type PracticeTarget } from '../weapons/CombatSystem';
import { WEAPONS } from '../weapons/weapons';
import { Combatant, type CosmeticLoadout } from '../player/Combatant';
import { stepMovement } from '../player/movement';
import { SLOT_COUNT } from '../inventory/Inventory';
import { AMMO_TYPES, itemLabel, type ItemStack, type SlotItem } from '../inventory/items';
import { rollChestLoot, rollFloorLoot } from '../loot/lootTables';
import { loadMap } from '../map/arenas';
import { Storm, BR_STORM, ZONEWAR_STORM } from '../storm/Storm';
import type { GameAction, PlayerInput } from '../networking/protocol';
import { BotBrain } from '../ai/BotBrain';
import { BOT_NAMES } from './modes';
import { WorldState, type Chest, type Door, type GroundItem } from './WorldState';
import type { DamageSource, GameEvents } from './events';
import type { BotDifficulty, MatchPhase, MatchResult, ModeConfig } from './matchTypes';

const log = logger('Match');

export interface MatchOptions {
  mode: ModeConfig;
  difficulty: BotDifficulty;
  playerName: string;
  cosmetics: CosmeticLoadout;
  botCosmetics: () => CosmeticLoadout;
  seed?: number;
  fallDamage?: boolean;
  autoPickup?: boolean;
}

export interface Interactable {
  kind: 'item' | 'chest' | 'door';
  id: number;
  label: string;
  pos: Vector3;
}

export interface BusState {
  start: Vector3;
  end: Vector3;
  pos: Vector3;
  dir: Vector3;
  t: number;
  duration: number;
}

const ROUND_WARMUP = 3;
const ROUND_END_TIME = 3;
const BR_WARMUP = 5;
const BUS_HEIGHT = 125;
const BUS_SPEED = 26;

/**
 * Authoritative offline match simulation. Runs at a fixed timestep and is
 * rendering-agnostic so it can be unit tested and later moved server-side.
 */
export class Match implements CombatHost {
  readonly events = new EventBus<GameEvents>();
  readonly world: WorldState;
  readonly builds: BuildSystem;
  readonly combat: CombatSystem;
  readonly rng: Rng;
  readonly mode: ModeConfig;
  storm: Storm | null = null;
  combatants: Combatant[] = [];
  human!: Combatant;
  brains: BotBrain[] = [];
  targets: PracticeTarget[] = [];
  bus: BusState | null = null;
  time = 0;
  phase: MatchPhase = 'LOADING';
  phaseTimer = 0;
  round = 1;
  result: MatchResult | null = null;
  /** Sim is paused (offline pause menu). */
  paused = false;
  fallDamage: boolean;
  autoPickup: boolean;
  private stormTick = 0;
  private prevJump = new Map<number, boolean>();
  private prevFire = new Map<number, boolean>();
  private actionQueue: { id: number; action: GameAction }[] = [];
  private nextTargetId = 1;
  private visitedCheck = 0;
  private humanDeathTime = -1;
  private roundWinnerId = -1;

  constructor(readonly opts: MatchOptions) {
    this.mode = opts.mode;
    this.rng = new Rng(opts.seed ?? Date.now() >>> 0);
    this.fallDamage = opts.fallDamage ?? opts.mode.fallDamage;
    this.autoPickup = opts.autoPickup ?? true;
    const map = loadMap(opts.mode.map);
    this.world = new WorldState(map);
    this.builds = new BuildSystem(this.world.collision, this.events, () => this.combatants);
    this.combat = new CombatSystem(this);
    this.setup();
  }

  // ------------------------------------------------------------------ setup

  private setup(): void {
    const m = this.mode;
    const human = new Combatant(0, this.opts.playerName, false, 0);
    human.cosmetics = { ...this.opts.cosmetics };
    this.human = human;
    this.combatants.push(human);
    const names = this.rng.shuffle([...BOT_NAMES]);
    for (let i = 0; i < m.bots; i++) {
      const bot = new Combatant(i + 1, names[i % names.length], true, i + 1);
      bot.cosmetics = this.opts.botCosmetics();
      this.combatants.push(bot);
      this.brains.push(new BotBrain(this, bot, this.opts.difficulty, 'fighter'));
    }
    for (const c of this.combatants) this.equipStart(c);

    if (m.loot) this.spawnLoot();
    if (m.id === 'br') {
      this.setupBus();
      this.setPhase('WARMUP', BR_WARMUP);
    } else if (m.training) {
      this.setupTraining();
      this.spawnAll();
      this.setPhase('ACTIVE', 0);
    } else {
      this.startRound();
    }
    if (m.storm && m.id === 'zonewar') this.createStorm();
    log.info(`match created: ${m.name} on ${this.world.map.name} with ${this.combatants.length} combatants`);
  }

  private equipStart(c: Combatant): void {
    const m = this.mode;
    c.inventory.clear();
    c.inventory.unlimitedAmmo = m.unlimitedAmmo;
    for (const item of m.loadout) c.inventory.add(structuredClone(item));
    if (!m.unlimitedAmmo) for (const a of AMMO_TYPES) c.inventory.ammo[a] = 0;
    if (m.materials === 'unlimited') {
      c.unlimitedMaterials = true;
      c.materials = { wood: MATERIAL_CAP, stone: MATERIAL_CAP, metal: MATERIAL_CAP };
    } else {
      c.unlimitedMaterials = false;
      c.materials = { ...m.materials };
    }
    c.shield = m.startShield;
    c.health = 100;
    c.inventory.selected = c.inventory.slots[0] ? 0 : 'pickaxe';
  }

  private createStorm(): void {
    const half = this.world.map.half;
    const phases = this.mode.id === 'br' ? BR_STORM : ZONEWAR_STORM;
    this.storm = new Storm(phases, half * 1.5, this.rng.int(1, 1e9), half * 0.85, (x, z) => {
      const water = this.world.waterAt(x, z);
      return water === null || this.world.collision.terrainHeight(x, z) > water + 0.5;
    });
  }

  private setupBus(): void {
    const half = this.world.map.half;
    const a = this.rng.range(0, Math.PI * 2);
    const off = this.rng.range(-40, 40);
    const r = half * 1.05;
    const perp = new Vector3(-Math.sin(a), 0, Math.cos(a));
    const start = new Vector3(Math.cos(a) * r, BUS_HEIGHT, Math.sin(a) * r).addScaledVector(perp, off);
    const end = new Vector3(-Math.cos(a) * r, BUS_HEIGHT, -Math.sin(a) * r).addScaledVector(perp, off);
    const dir = new Vector3().subVectors(end, start).normalize();
    this.bus = { start, end, pos: start.clone(), dir, t: 0, duration: start.distanceTo(end) / BUS_SPEED };
    for (const c of this.combatants) {
      c.air = 'bus';
      c.pos.copy(start);
      c.vel.set(0, 0, 0);
      c.yaw = Math.atan2(-dir.x, -dir.z);
    }
  }

  private spawnLoot(): void {
    const map = this.world.map;
    for (const s of map.lootSpots) {
      if (!this.rng.chance(0.78)) continue;
      const items = rollFloorLoot(this.rng);
      items.forEach((it, i) => this.world.spawnItem(it, { x: s[0] + i * 0.7, y: s[1], z: s[2] + i * 0.3 }));
    }
  }

  /** Place combatants at spawn points (non-BR). */
  private spawnAll(): void {
    const spawns = this.world.map.spawns;
    const order = this.mode.id === 'zonewar' ? this.rng.shuffle([...spawns.keys()]) : [...spawns.keys()];
    this.combatants.forEach((c, i) => {
      if (this.isDummy(c)) return;
      const s = spawns[order[i % order.length]];
      this.placeAt(c, s[0], s[1]);
      c.yaw = Math.atan2(s[0], s[1]); // face the arena centre
    });
  }

  placeAt(c: Combatant, x: number, z: number): void {
    c.pos.set(x, this.world.supportHeight(x, z, 400) + 0.05, z);
    c.vel.set(0, 0, 0);
    c.air = 'none';
    c.grounded = false;
  }

  private isDummy(c: Combatant): boolean {
    return this.brains.some((b) => b.self === c && b.role === 'dummy');
  }

  private setupTraining(): void {
    const h = this.human;
    // Practice targets at the aim station (0, 40).
    for (let i = 0; i < 5; i++) this.addTarget('static', new Vector3(-8 + i * 4, 3 + (i % 2) * 2.5, 52));
    for (let i = 0; i < 3; i++) this.addTarget('moving', new Vector3(0, 2.2 + i * 2.6, 58));
    for (let i = 0; i < 2; i++) this.addTarget('reaction', new Vector3(0, 2.5, 50));
    // Strafing dummies (damage testing).
    for (let i = 0; i < 3; i++) {
      const bot = new Combatant(100 + i, `Dummy ${i + 1}`, true, 100 + i);
      bot.cosmetics = this.opts.botCosmetics();
      bot.shield = MAX_SHIELD;
      this.combatants.push(bot);
      const brain = new BotBrain(this, bot, 'normal', 'dummy');
      brain.home.set(-12 + i * 12, 0, 44 + (i % 2) * 6);
      this.brains.push(brain);
      this.placeAt(bot, brain.home.x, brain.home.z);
    }
    this.buildTrainingStructures();
    void h;
  }

  /** Pre-built practice structures (owned by the human so they can be edited). */
  buildTrainingStructures(): void {
    const h = this.human;
    const place = (piece: BuildPieceType, gx: number, gy: number, gz: number, rot: number, mask?: number) => {
      const p = this.builds.place(makeTarget(piece, { x: gx, y: gy, z: gz }, rot), null, { ownerId: h.id, material: 'wood' });
      if (p) {
        p.health = p.maxHealth;
        p.progress = 1;
        if (mask !== undefined) this.builds.applyEdit(p.id, null, mask);
      }
    };
    // Edit practice: a row of walls at the edit station (-40, 24) → cells x -12..-9, z 6.
    const presets = [WALL_PRESETS.full, WALL_PRESETS.window, WALL_PRESETS.door, WALL_PRESETS.full];
    presets.forEach((mask, i) => place('wall', -12 + i, 0, 7, 1, mask));
    // Box fight practice at (40, 24) → cell (10, 6)
    place('floor', 10, 0, 6, 0);
    place('wall', 10, 0, 6, 1);
    place('wall', 10, 0, 7, 1);
    place('wall', 10, 0, 6, 0);
    place('wall', 11, 0, 6, 0);
    place('cone', 10, 1, 6, 0);
  }

  private addTarget(kind: PracticeTarget['kind'], pos: Vector3): void {
    this.targets.push({ id: this.nextTargetId++, kind, pos: pos.clone(), base: pos.clone(), radius: 0.55, alive: kind !== 'reaction', respawnAt: kind === 'reaction' ? 1 : 0, phase: this.rng.range(0, 6), hitAt: -9 });
  }

  // ------------------------------------------------------------------ rounds

  private startRound(): void {
    this.builds.resetAll();
    this.world.restoreBarriers();
    for (const c of this.combatants) {
      c.resetForRound();
      this.equipStart(c);
    }
    this.world.items.clear();
    this.spawnAll();
    if (this.mode.id === 'boxfight') this.buildBoxFightBoxes();
    if (this.mode.id === 'zonewar') this.createStorm();
    this.roundWinnerId = -1;
    this.humanDeathTime = -1;
    this.setPhase('WARMUP', ROUND_WARMUP);
    this.events.emit('ROUND_STARTED', { round: this.round });
  }

  private buildBoxFightBoxes(): void {
    for (const c of this.combatants) {
      const gx = Math.floor(c.pos.x / TILE);
      const gz = Math.floor(c.pos.z / TILE);
      const gy = Math.round(this.world.collision.terrainHeight(c.pos.x, c.pos.z) / TILE_H);
      const own = { ownerId: c.id, material: 'wood' as const };
      const pieces: [BuildPieceType, number, number, number, number][] = [
        ['wall', gx, gy, gz, 0],
        ['wall', gx + 1, gy, gz, 0],
        ['wall', gx, gy, gz, 1],
        ['wall', gx, gy, gz + 1, 1],
        ['cone', gx, gy + 1, gz, 0],
      ];
      // Temporarily lift the player out so walls validate, then restore.
      const saved = c.pos.clone();
      c.alive = false;
      for (const [piece, x, y, z, r] of pieces) {
        const p = this.builds.place(makeTarget(piece, { x, y, z }, r), null, own);
        if (p) {
          p.health = p.maxHealth;
          p.progress = 1;
          p.teamId = c.teamId;
        }
      }
      c.alive = true;
      c.pos.copy(saved);
    }
  }

  private endRound(winner: Combatant | null): void {
    this.roundWinnerId = winner ? winner.id : -1;
    if (winner) winner.roundWins++;
    this.events.emit('ROUND_ENDED', { round: this.round, winnerId: this.roundWinnerId });
    this.setPhase('ROUND_END', ROUND_END_TIME);
  }

  private afterRoundEnd(): void {
    const target = this.mode.roundsToWin;
    const champion = this.combatants.find((c) => c.roundWins >= target);
    if (champion) {
      this.finish(champion === this.human);
      return;
    }
    this.round++;
    this.startRound();
  }

  // ------------------------------------------------------------------ phases

  private setPhase(phase: MatchPhase, timer: number): void {
    this.phase = phase;
    this.phaseTimer = timer;
    this.events.emit('MATCH_PHASE', { phase });
  }

  get isRoundMode(): boolean {
    return this.mode.roundsToWin > 0;
  }

  get aliveCount(): number {
    let n = 0;
    for (const c of this.combatants) if (c.alive && !this.isDummy(c)) n++;
    return n;
  }

  get totalPlayers(): number {
    return this.combatants.filter((c) => !this.isDummy(c)).length;
  }

  /** Whether gameplay input should be applied (movement allowed). */
  get live(): boolean {
    return this.phase === 'ACTIVE' || this.phase === 'STORM_PHASE' || this.phase === 'FINAL_CIRCLE' || this.phase === 'DEPLOYMENT' || this.phase === 'ELIMINATED' || this.phase === 'WARMUP' || this.phase === 'ROUND_END';
  }

  setInput(id: number, input: PlayerInput): void {
    const c = this.combatants.find((x) => x.id === id);
    if (c) c.input = input;
  }

  queueAction(id: number, action: GameAction): void {
    this.actionQueue.push({ id, action });
  }

  // ------------------------------------------------------------------ step

  step(dt = SIM_DT): void {
    if (this.paused || this.phase === 'RESULTS') return;
    this.time += dt;
    this.builds.update(dt);

    // Phase timers
    this.updatePhase(dt);

    // Bot brains
    for (const b of this.brains) b.update(dt);

    // Actions
    const actions = this.actionQueue;
    this.actionQueue = [];
    for (const { id, action } of actions) {
      const c = this.combatants.find((x) => x.id === id);
      if (c && c.alive) this.handleAction(c, action);
    }

    // Movement + combat
    const frozen = this.phase === 'WARMUP' && this.mode.id === 'br';
    for (const c of this.combatants) {
      if (!c.alive) continue;
      c.yaw = c.input.yaw;
      c.pitch = c.input.pitch;
      if (c.air === 'bus') {
        if (this.bus) c.pos.copy(this.bus.pos);
        continue;
      }
      if (frozen) continue;
      const prevJump = this.prevJump.get(c.id) ?? false;
      const mv = stepMovement(c, this.world.collision, dt, this.world.waterAt(c.pos.x, c.pos.z), prevJump);
      this.prevJump.set(c.id, c.input.jump);
      if (mv.jumped) this.events.emit('JUMP', { combatantId: c.id });
      if (mv.gliderOpened) this.events.emit('GLIDER', { combatantId: c.id, open: true });
      if (mv.landed) {
        this.events.emit('LANDED', { combatantId: c.id, speed: mv.landingSpeed });
        if (this.fallDamage && mv.landingSpeed > FALL_DAMAGE_SPEED && this.phase !== 'WARMUP') {
          const dmg = Math.round((mv.landingSpeed - FALL_DAMAGE_SPEED) * FALL_DAMAGE_PER_MS);
          this.applyDamage(c, dmg, null, 'fall', false, c.pos.clone(), 'fall');
          if (!c.alive) continue;
        }
      }
      if (c.emoteTimer > 0) c.emoteTimer -= dt;
      const combatAllowed = this.phase !== 'WARMUP' && this.phase !== 'ROUND_END';
      const prevFire = this.prevFire.get(c.id) ?? false;
      this.combat.update(c, dt, combatAllowed && c.input.fire, prevFire);
      this.prevFire.set(c.id, c.input.fire);
      if (this.phase !== 'ROUND_END') c.stats.survivalTime += dt;
      this.checkBounds(c);
    }

    this.world.updateItems(dt);
    if (this.autoPickup) this.autoPickupNearby(this.human);
    this.updateTargets(dt);
    this.updateStorm(dt);
    this.checkPoiVisits(dt);
    this.checkEnd();
  }

  private updatePhase(dt: number): void {
    if (this.phaseTimer > 0) this.phaseTimer -= dt;
    switch (this.phase) {
      case 'WARMUP':
        if (this.phaseTimer <= 0) {
          if (this.mode.id === 'br') {
            this.setPhase('DEPLOYMENT', 0);
          } else {
            this.world.removeBarriers();
            this.setPhase('ACTIVE', 0);
          }
        }
        break;
      case 'DEPLOYMENT': {
        const bus = this.bus!;
        bus.t += dt;
        const f = Math.min(1, bus.t / bus.duration);
        bus.pos.lerpVectors(bus.start, bus.end, f);
        if (f >= 1) {
          for (const c of this.combatants) if (c.air === 'bus') this.jumpFromBus(c);
        }
        if (!this.combatants.some((c) => c.air === 'bus')) {
          if (!this.storm) this.createStorm();
          this.setPhase(this.human.alive ? 'ACTIVE' : 'ELIMINATED', 0);
        }
        break;
      }
      case 'ROUND_END':
        if (this.phaseTimer <= 0) this.afterRoundEnd();
        break;
      default:
        break;
    }
  }

  private updateStorm(dt: number): void {
    const s = this.storm;
    if (!s || this.phase === 'WARMUP' || this.phase === 'DEPLOYMENT' || this.phase === 'ROUND_END') return;
    const r = s.update(dt);
    if (r.event === 'shrinkStart') {
      this.events.emit('STORM_PHASE', { phase: s.phase, message: s.isFinal ? 'FINAL CIRCLE CLOSING' : 'STORM CLOSING' });
      if (this.phase === 'ACTIVE' || this.phase === 'STORM_PHASE') this.setPhase(s.isFinal ? 'FINAL_CIRCLE' : 'STORM_PHASE', 0);
    } else if (r.event === 'phaseEnd') {
      this.events.emit('STORM_PHASE', { phase: s.phase, message: s.stage === 'done' ? 'THE STORM HAS FULLY CLOSED' : 'STORM HOLDING' });
    }
    this.stormTick += dt;
    if (this.stormTick >= 1) {
      this.stormTick -= 1;
      for (const c of this.combatants) {
        if (!c.alive || c.air === 'bus' || this.isDummy(c)) continue;
        if (!s.isInside(c.pos.x, c.pos.z)) this.applyDamage(c, s.dps, null, 'storm', false, c.pos.clone(), 'storm');
      }
    }
  }

  private checkBounds(c: Combatant): void {
    const floor = this.world.collision.terrainHeight(c.pos.x, c.pos.z) - 12;
    if (c.pos.y < floor || c.pos.y < -50) {
      if (this.mode.id === 'br' || this.isRoundMode) this.applyDamage(c, 999, null, 'bounds', false, c.pos.clone(), 'bounds');
      else this.respawn(c);
    }
  }

  respawn(c: Combatant): void {
    const brain = this.brains.find((b) => b.self === c);
    const s = brain?.role === 'dummy' ? [brain.home.x, brain.home.z] : this.world.map.spawns[0];
    c.resetForRound();
    c.shield = this.mode.startShield || (brain?.role === 'dummy' ? MAX_SHIELD : 0);
    this.placeAt(c, s[0], s[1]);
  }

  private updateTargets(dt: number): void {
    for (const t of this.targets) {
      if (!t.alive) {
        if (this.time >= t.respawnAt) {
          t.alive = true;
          if (t.kind === 'reaction') {
            t.pos.set(t.base.x + this.rng.range(-10, 10), t.base.y + this.rng.range(0, 4), t.base.z + this.rng.range(-2, 6));
            t.respawnAt = this.time + 2.2; // expires if not hit in time
          }
        }
        continue;
      }
      if (t.kind === 'moving') {
        t.phase += dt;
        t.pos.x = t.base.x + Math.sin(t.phase * (0.8 + t.base.y * 0.05)) * 9;
      } else if (t.kind === 'reaction' && this.time >= t.respawnAt) {
        t.alive = false;
        t.respawnAt = this.time + this.rng.range(0.4, 1.4);
      }
    }
  }

  onPracticeTargetHit(t: PracticeTarget, shooter: Combatant, amount: number, point: Vector3): void {
    t.hitAt = this.time;
    t.alive = false;
    t.respawnAt = this.time + (t.kind === 'reaction' ? this.rng.range(0.4, 1.2) : 1.2);
    this.events.emit('PLAYER_DAMAGE', { targetId: -100 - t.id, attackerId: shooter.id, amount: Math.round(amount), shieldDamage: 0, healthDamage: Math.round(amount), headshot: false, point, source: 'weapon' });
  }

  private checkPoiVisits(dt: number): void {
    this.visitedCheck += dt;
    if (this.visitedCheck < 1) return;
    this.visitedCheck = 0;
    for (const c of this.combatants) {
      if (!c.alive || c.air !== 'none') continue;
      for (const p of this.world.map.pois) {
        if (c.stats.poisVisited.has(p.id)) continue;
        if (Math.hypot(c.pos.x - p.x, c.pos.z - p.z) < p.radius * 0.7) {
          c.stats.poisVisited.add(p.id);
          this.events.emit('POI_VISITED', { combatantId: c.id, poi: p.name });
        }
      }
    }
  }

  private checkEnd(): void {
    if (this.mode.training) return;
    const alive = this.combatants.filter((c) => c.alive && !this.isDummy(c));
    if (this.isRoundMode) {
      if (this.phase !== 'ACTIVE' && this.phase !== 'STORM_PHASE' && this.phase !== 'FINAL_CIRCLE') return;
      if (alive.length <= 1) {
        this.endRound(alive[0] ?? null);
      } else if (!this.human.alive) {
        if (this.humanDeathTime < 0) this.humanDeathTime = this.time;
        if (this.time - this.humanDeathTime > 2) {
          const best = [...alive].sort((a, b) => b.health + b.shield - (a.health + a.shield))[0];
          this.endRound(best);
        }
      }
      return;
    }
    // Battle royale
    if (this.phase === 'VICTORY' || this.phase === 'RESULTS') return;
    if (this.human.alive && alive.length === 1 && this.phase !== 'WARMUP' && this.phase !== 'DEPLOYMENT') {
      this.human.placement = 1;
      this.finish(true);
    } else if (!this.human.alive && this.phase !== 'ELIMINATED') {
      this.finish(false);
    }
  }

  private finish(won: boolean): void {
    const h = this.human;
    if (this.isRoundMode) {
      const ranking = [...this.combatants].sort((a, b) => b.roundWins - a.roundWins);
      h.placement = won ? 1 : Math.max(2, ranking.indexOf(h) + 1);
    }
    this.result = {
      mode: this.mode.id,
      modeName: this.mode.name,
      won,
      placement: won ? 1 : h.placement || this.aliveCount + 1,
      totalPlayers: this.totalPlayers,
      eliminations: h.stats.eliminations,
      damage: Math.round(h.stats.damageDealt),
      damageTaken: Math.round(h.stats.damageTaken),
      headshots: h.stats.headshots,
      survivalTime: h.stats.survivalTime,
      builds: h.stats.buildsPlaced,
      edits: h.stats.edits,
      materialsGathered: h.stats.materialsGathered,
      materialsUsed: h.stats.materialsUsed,
      chestsOpened: h.stats.chestsOpened,
      poisVisited: [...h.stats.poisVisited],
      roundsWon: this.isRoundMode ? h.roundWins : 0,
      roundsLost: this.isRoundMode ? Math.max(0, this.round - h.roundWins) : 0,
      timestamp: Date.now(),
    };
    this.setPhase(won ? 'VICTORY' : 'ELIMINATED', 0);
    this.events.emit('MATCH_ENDED', { result: this.result });
  }

  /** Called by the client when the results screen is shown. */
  markResults(): void {
    this.setPhase('RESULTS', 0);
  }

  /** Spectating after elimination: keep simulating; returns true once the match is decided. */
  get decided(): boolean {
    return this.aliveCount <= 1;
  }

  // ------------------------------------------------------------------ damage

  applyDamage(target: Combatant, amount: number, attacker: Combatant | null, source: DamageSource, headshot: boolean, point: Vector3, weapon: string): void {
    if (!target.alive || amount <= 0) return;
    if (attacker && attacker !== target && attacker.teamId === target.teamId) return;
    if (this.phase === 'WARMUP' && source !== 'bounds') return;
    const bypassShield = source === 'storm' || source === 'fall' || source === 'bounds';
    const shieldDamage = bypassShield ? 0 : Math.min(target.shield, amount);
    target.shield -= shieldDamage;
    const healthDamage = Math.min(target.health, amount - shieldDamage);
    target.health -= amount - shieldDamage;
    target.lastDamagedAt = this.time;
    if (attacker && attacker !== target) {
      target.lastAttackerId = attacker.id;
      attacker.stats.damageDealt += shieldDamage + healthDamage;
      attacker.lastHitAt = this.time;
      if (headshot) attacker.stats.headshots++;
    }
    target.stats.damageTaken += shieldDamage + healthDamage;
    this.events.emit('PLAYER_DAMAGE', { targetId: target.id, attackerId: attacker?.id ?? -1, amount: Math.round(shieldDamage + healthDamage), shieldDamage, healthDamage, headshot, point, source });
    target.emoteTimer = 0;
    if (target.health <= 0) this.eliminate(target, attacker ?? (target.lastAttackerId >= 0 && this.time - target.lastDamagedAt < 10 ? this.byId(target.lastAttackerId) : null), weapon, source);
  }

  byId(id: number): Combatant | null {
    return this.combatants.find((c) => c.id === id) ?? null;
  }

  private eliminate(victim: Combatant, killer: Combatant | null, weapon: string, source: DamageSource): void {
    const placement = this.aliveCount;
    victim.alive = false;
    victim.health = 0;
    victim.placement = placement;
    victim.deathTime = this.time;
    victim.killerId = killer?.id ?? -1;
    victim.buildPiece = null;
    victim.editingPieceId = -1;
    if (killer && killer !== victim) killer.stats.eliminations++;
    this.events.emit('PLAYER_ELIMINATED', { victimId: victim.id, killerId: killer?.id ?? -1, weapon, source, placement });
    if (this.mode.id === 'br') this.dropInventory(victim);
    const brain = this.brains.find((b) => b.self === victim);
    if (brain?.role === 'dummy') brain.respawnAt = this.time + 3;
  }

  private dropInventory(c: Combatant): void {
    const drops: ItemStack[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const it = c.inventory.take(i);
      if (it) drops.push(it);
    }
    for (const a of AMMO_TYPES) if (c.inventory.ammo[a] > 0) drops.push({ kind: 'ammo', ammo: a, count: c.inventory.ammo[a] });
    for (const m of BUILD_MATERIALS) if (c.materials[m] > 0) drops.push({ kind: 'material', material: m, count: Math.min(c.materials[m], 300) });
    drops.forEach((d) => this.world.spawnItem(d, { x: c.pos.x, y: c.pos.y + 1, z: c.pos.z }, true, this.time));
  }

  // ------------------------------------------------------------------ actions

  handleAction(c: Combatant, a: GameAction): void {
    const inv = c.inventory;
    switch (a.type) {
      case 'selectSlot':
        if (a.slot < 0 || a.slot >= SLOT_COUNT) return;
        if (c.buildPiece !== null) c.buildPiece = null;
        c.editingPieceId = -1;
        if (inv.selected !== a.slot) {
          inv.selected = a.slot;
          c.switchTimer = 0.1;
          this.events.emit('WEAPON_SWITCH', { combatantId: c.id, weapon: inv.slots[a.slot]?.kind === 'weapon' ? (inv.slots[a.slot] as { id: string }).id : 'item' });
        }
        break;
      case 'selectPickaxe':
        c.buildPiece = null;
        c.editingPieceId = -1;
        if (inv.selected !== 'pickaxe') {
          inv.selected = 'pickaxe';
          c.switchTimer = 0.1;
          this.events.emit('WEAPON_SWITCH', { combatantId: c.id, weapon: 'pickaxe' });
        }
        break;
      case 'cycleWeapon': {
        c.buildPiece = null;
        const order: (number | 'pickaxe')[] = ['pickaxe', 0, 1, 2, 3, 4];
        const filled = order.filter((s) => s === 'pickaxe' || inv.slots[s] !== null);
        let i = filled.indexOf(inv.selected);
        i = (i + a.delta + filled.length) % filled.length;
        const next = filled[i];
        if (next === 'pickaxe') this.handleAction(c, { type: 'selectPickaxe' });
        else this.handleAction(c, { type: 'selectSlot', slot: next });
        break;
      }
      case 'selectBuild':
        if (c.air !== 'none') return;
        c.editingPieceId = -1;
        c.buildPiece = a.piece;
        c.useTimer = 0;
        c.reloadTimer = 0;
        break;
      case 'exitBuild':
        c.buildPiece = null;
        break;
      case 'rotateBuild':
        c.buildRotation = (c.buildRotation + 1) & 3;
        break;
      case 'cycleMaterial': {
        const i = BUILD_MATERIALS.indexOf(c.buildMaterial);
        c.buildMaterial = BUILD_MATERIALS[(i + 1) % 3];
        break;
      }
      case 'place': {
        if (c.buildPiece === null || this.phase === 'ROUND_END' || c.air !== 'none') return;
        if (this.phase === 'WARMUP' && this.mode.id !== 'boxfight') return;
        const piece = this.builds.place(a.target, c);
        if (piece) {
          c.stats.buildsPlaced++;
          if (!c.unlimitedMaterials) c.stats.materialsUsed += 10;
          c.lastBuildAt = this.time;
        }
        break;
      }
      case 'edit': {
        const piece = this.builds.pieces.get(a.pieceId);
        if (!piece) return;
        if (this.builds.applyEdit(a.pieceId, c, a.mask, a.rampDir)) c.stats.edits++;
        break;
      }
      case 'resetEdit':
        this.builds.resetEdit(a.pieceId, c);
        break;
      case 'reload':
        this.combat.startReload(c);
        break;
      case 'interact':
        this.interact(c);
        break;
      case 'jumpFromBus':
        if (c.air === 'bus' && this.phase === 'DEPLOYMENT') this.jumpFromBus(c);
        break;
      case 'toggleGlider':
        if (c.air === 'skydive') {
          c.air = 'glide';
          this.events.emit('GLIDER', { combatantId: c.id, open: true });
        } else if (c.air === 'glide' && c.pos.y - this.world.collision.terrainHeight(c.pos.x, c.pos.z) > 25) {
          c.air = 'skydive';
          this.events.emit('GLIDER', { combatantId: c.id, open: false });
        }
        break;
      case 'emote':
        if (c.air === 'none' && c.grounded && c.buildPiece === null) {
          c.emoteId = a.emoteId;
          c.emoteTimer = 5;
          this.events.emit('EMOTE', { combatantId: c.id, emoteId: a.emoteId });
        }
        break;
      case 'dropSlot': {
        if (this.mode.id !== 'br') return;
        const it = inv.take(a.slot);
        if (it) this.world.spawnItem(it, { x: c.pos.x, y: c.pos.y + 1, z: c.pos.z }, true, this.time);
        break;
      }
      case 'respawn':
        if (this.mode.respawn === 'manual') {
          this.respawn(c);
          this.equipStart(c);
        }
        break;
      case 'resetBuilds':
        if (this.mode.training) {
          this.builds.resetAll();
          this.buildTrainingStructures();
          this.events.emit('NOTICE', { text: 'Builds reset', kind: 'info' });
        }
        break;
    }
  }

  jumpFromBus(c: Combatant): void {
    if (!this.bus) return;
    c.air = 'skydive';
    c.pos.copy(this.bus.pos).y -= 3;
    c.vel.copy(this.bus.dir).multiplyScalar(BUS_SPEED * 0.4);
    c.grounded = false;
    c.inventory.selected = 'pickaxe';
  }

  // ------------------------------------------------------------------ interaction / loot

  /** The interactable under the crosshair / closest in front of the player. */
  findInteractable(c: Combatant): Interactable | null {
    if (!c.alive || c.air !== 'none') return null;
    const eye = c.eye(new Vector3());
    const dir = new Vector3(c.input.rayDir.x, c.input.rayDir.y, c.input.rayDir.z).normalize();
    let best: Interactable | null = null;
    let bestScore = Infinity;
    const consider = (kind: Interactable['kind'], id: number, pos: Vector3, label: string, range = INTERACT_RANGE) => {
      const to = new Vector3().subVectors(pos, eye);
      const dist = to.length();
      if (dist > range) return;
      const along = to.dot(dir);
      if (along < -0.3) return;
      const perp = Math.sqrt(Math.max(0, dist * dist - along * along));
      const score = perp * 2 + dist * 0.35;
      if (perp > 1.4 && dist > 1.4) return;
      if (score < bestScore) {
        bestScore = score;
        best = { kind, id, label, pos };
      }
    };
    for (const it of this.world.items.values()) {
      if (it.item.kind === 'ammo' || it.item.kind === 'material') {
        consider('item', it.id, it.pos, `PICK UP ${itemLabel(it.item).toUpperCase()}`);
      } else consider('item', it.id, new Vector3(it.pos.x, it.pos.y + 0.3, it.pos.z), `PICK UP ${itemLabel(it.item).toUpperCase()}`);
    }
    for (const ch of this.world.chests) {
      if (ch.opened) continue;
      consider('chest', ch.id, new Vector3(ch.spec.x, ch.spec.y + 0.5, ch.spec.z), ch.spec.kind === 'supply' ? 'OPEN SUPPLY CRATE' : 'OPEN CHEST');
    }
    for (const d of this.world.doors) {
      consider('door', d.id, new Vector3(d.spec.x, d.spec.y + 1.2, d.spec.z), d.open ? 'CLOSE DOOR' : 'OPEN DOOR', INTERACT_RANGE + 0.4);
    }
    return best;
  }

  interact(c: Combatant): void {
    const target = this.findInteractable(c);
    if (!target) return;
    if (target.kind === 'item') {
      const it = this.world.items.get(target.id);
      if (it) this.pickup(c, it);
    } else if (target.kind === 'chest') {
      this.openChest(c, this.world.chests[target.id]);
    } else {
      this.toggleDoor(this.world.doors[target.id]);
    }
  }

  toggleDoor(d: Door): void {
    this.world.setDoor(d, !d.open);
    this.events.emit('DOOR_TOGGLED', { doorId: d.id, open: d.open, point: { x: d.spec.x, y: d.spec.y + 1, z: d.spec.z } });
  }

  openChest(c: Combatant, ch: Chest): void {
    if (ch.opened) return;
    ch.opened = true;
    c.stats.chestsOpened++;
    const items = rollChestLoot(this.rng, ch.spec.kind === 'supply');
    for (const it of items) this.world.spawnItem(it, { x: ch.spec.x, y: ch.spec.y + 0.8, z: ch.spec.z }, true, this.time);
    this.events.emit('CHEST_OPENED', { combatantId: c.id, chestId: ch.id, point: { x: ch.spec.x, y: ch.spec.y, z: ch.spec.z } });
  }

  pickup(c: Combatant, g: GroundItem): boolean {
    const item = g.item;
    const inv = c.inventory;
    if (item.kind === 'ammo') {
      inv.addAmmo(item.ammo, item.count);
      this.world.items.delete(g.id);
    } else if (item.kind === 'material') {
      const before = c.materials[item.material];
      c.materials[item.material] = Math.min(MATERIAL_CAP, before + item.count);
      item.count -= c.materials[item.material] - before;
      if (item.count <= 0) this.world.items.delete(g.id);
    } else {
      const slotItem = item as SlotItem;
      if (inv.hasRoomFor(slotItem)) {
        inv.add(slotItem);
        if (slotItem.kind === 'consumable' && slotItem.count > 0) return false;
        this.world.items.delete(g.id);
      } else {
        // Swap with the held slot (or slot 0 when holding the pickaxe).
        const slot = inv.selected === 'pickaxe' ? 0 : inv.selected;
        const old = inv.take(slot);
        inv.slots[slot] = { ...slotItem } as SlotItem;
        this.world.items.delete(g.id);
        if (old) this.world.spawnItem(old, { x: g.pos.x, y: g.pos.y + 0.5, z: g.pos.z }, true, this.time);
      }
    }
    this.events.emit('ITEM_PICKED_UP', { combatantId: c.id, item });
    return true;
  }

  /** Ammo and materials are collected automatically when walking over them. */
  private autoPickupNearby(c: Combatant): void {
    if (!c.alive || c.air !== 'none') return;
    for (const g of this.world.items.values()) {
      if (!g.settled) continue;
      if (g.item.kind !== 'ammo' && g.item.kind !== 'material') continue;
      if (g.pos.distanceToSquared(c.pos) < 1.6 * 1.6) this.pickup(c, g);
    }
  }

  /** Weapon + ammo summary helper for HUD. */
  reserveFor(c: Combatant): number | null {
    const w = c.inventory.currentWeapon();
    if (!w) return null;
    return c.unlimitedAmmo ? Infinity : c.inventory.ammo[WEAPONS[w.id].ammo];
  }

  dispose(): void {
    this.events.clear();
  }
}

