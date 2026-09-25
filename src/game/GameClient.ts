import {
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Scene,
  Vector3,
} from 'three';
import { MAX_SIM_STEPS, SIM_DT, EYE_HEIGHT } from '../core/constants';
import { logger } from '../core/log';
import { dirFromYawPitch } from '../core/math';
import type { RenderContext } from '../rendering/RenderContext';
import type { AudioEngine } from '../audio/AudioEngine';
import type { SaveManager } from '../save/SaveManager';
import type { Progression, MatchSummary } from '../progression/Progression';
import type { Input } from '../input/Input';
import type { Overlay } from '../ui/overlay';
import { Match } from './Match';
import { MODES } from './modes';
import type { BotDifficulty, MatchResult, ModeId } from './matchTypes';
import { LocalGameAdapter } from '../networking/LocalGameAdapter';
import { emptyInput, type PlayerInput } from '../networking/protocol';
import { CameraController } from '../camera/CameraController';
import { WorldView } from '../rendering/WorldView';
import { BuildView } from '../rendering/BuildView';
import { CharacterModel, emoteAnim, type AnimState, type HeldItem } from '../rendering/CharacterModel';
import { Effects } from '../rendering/Effects';
import { Sky, DAY_SKY } from '../rendering/Sky';
import { StormView } from '../rendering/StormView';
import { LootView } from '../rendering/LootView';
import { BusView } from '../rendering/BusView';
import { Hud } from '../ui/Hud';
import { MapRenderer } from '../ui/Minimap';
import { BuildController, type CameraRay } from './BuildController';
import { ClientEffects } from './ClientEffects';
import { DebugOverlay } from '../debug/DebugOverlay';
import { Tutorial } from './Tutorial';
import { CONSUMABLES, AMMO_TYPES, AMMO_LABEL, RARITY_INFO, itemLabel, itemRarity } from '../inventory/items';
import { WEAPONS } from '../weapons/weapons';
import { h } from '../ui/dom';
import type { Combatant, CosmeticLoadout } from '../player/Combatant';
import { COSMETICS } from '../cosmetics/catalog';
import { Rng } from '../core/rng';
import { makeWeapon } from '../loot/lootTables';
import type { SlotItem } from '../inventory/items';
import type { BuildPieceType } from '../building/grid';

const log = logger('Client');

export interface GameClientHost {
  render: RenderContext;
  audio: AudioEngine;
  save: SaveManager;
  progression: Progression;
  input: Input;
  overlay: Overlay;
  hudParent: HTMLElement;
  dev: boolean;
  requestPause(): void;
  matchEnded(result: MatchResult, summary: MatchSummary | null): void;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Random bot cosmetics from the catalogue (bots also get to look good). */
function botCosmeticsFactory(seed: number): () => CosmeticLoadout {
  const rng = new Rng(seed);
  const pick = (cat: string) => rng.pick(COSMETICS.filter((c) => c.category === cat)).id;
  return () => ({ outfit: pick('outfit'), backpack: pick('backpack'), pickaxe: pick('pickaxe'), glider: pick('glider'), wrap: pick('wrap'), emote: pick('emote') });
}

/**
 * One gameplay session: owns the Match, the local adapter, scene, views,
 * HUD and the input → simulation → render loop.
 */
export class GameClient {
  match!: Match;
  adapter!: LocalGameAdapter;
  readonly scene = new Scene();
  camera!: CameraController;
  private world!: WorldView;
  private builds!: BuildView;
  private effects!: Effects;
  private sky!: Sky;
  private stormView!: StormView;
  private loot!: LootView;
  private busView!: BusView;
  private sun!: DirectionalLight;
  hud!: Hud;
  private fx!: ClientEffects;
  private buildCtl!: BuildController;
  private debug: DebugOverlay | null = null;
  tutorial: Tutorial | null = null;
  private models = new Map<number, CharacterModel>();
  private prevPos = new Map<number, Vector3>();
  private accumulator = 0;
  private simTime = 0;
  private renderTime = 0;
  private fps = 60;
  private crouchToggled = false;
  private sprintToggle = false;
  private spectateId = -1;
  private ended = false;
  private endReported = false;
  paused = false;
  private inventoryOpen = false;
  private inventoryEl: HTMLElement | null = null;
  private nameplateLayer!: HTMLElement;
  private nameplates = new Map<number, { el: HTMLElement; visible: boolean; checkAt: number }>();
  private footstepTimer = 0;
  private lastPhase = '';
  private lastCountdown = -1;
  private lastBuildPiece: BuildPieceType = 'wall';
  private summary: MatchSummary | null = null;
  private ePressedAt = 0;
  private lastLookDelta = 0;
  readonly modeId: ModeId;
  private unsubs: (() => void)[] = [];
  private disposed = false;

  constructor(private host: GameClientHost, modeId: ModeId, private difficulty: BotDifficulty) {
    this.modeId = modeId;
  }

  get settings() {
    return this.host.save.data.settings;
  }

  /** Build the match and scene, reporting real progress. */
  async load(progress: (fraction: number, label: string) => void): Promise<void> {
    const mode = MODES[this.modeId];
    const s = this.settings;
    const profile = this.host.save.data.profile;
    progress(0.05, 'Generating terrain');
    await nextFrame();
    const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    const eq = profile.equipped;
    this.match = new Match({
      mode,
      difficulty: this.difficulty,
      playerName: profile.displayName,
      cosmetics: { outfit: eq.outfit, backpack: eq.backpack, pickaxe: eq.pickaxe, glider: eq.glider, wrap: eq.wrap, emote: eq.emote },
      botCosmetics: botCosmeticsFactory(seed),
      seed,
      fallDamage: mode.training ? s.gameplay.trainingFallDamage : undefined,
      autoPickup: s.gameplay.autoPickup,
    });
    this.adapter = new LocalGameAdapter(this.match, this.match.human.id);
    await this.adapter.connect();
    progress(0.25, 'Building world');
    await nextFrame();

    const v = s.video;
    const low = v.preset === 'low' || v.effects === 'low';
    const shadows = v.shadows !== 'off';
    this.world = new WorldView(this.match.world, {
      lowQuality: low,
      ambientOcclusion: v.ambientOcclusion,
      shadows,
      pointLights: v.effects === 'low' ? 0 : v.effects === 'medium' ? 3 : 6,
    });
    this.scene.add(this.world.group);
    progress(0.55, 'Placing structures');
    await nextFrame();

    this.setupLighting();
    this.builds = new BuildView(shadows);
    this.effects = new Effects(v.particles, v.effects);
    this.stormView = new StormView();
    this.loot = new LootView();
    this.busView = new BusView();
    this.scene.add(this.builds.group, this.effects.group, this.stormView.group, this.loot.group, this.busView.group);
    this.camera = new CameraController(this.host.render.aspect);
    this.applySettings();
    progress(0.7, 'Preparing combatants');
    await nextFrame();

    for (const c of this.match.combatants) this.modelFor(c);
    // Pieces pre-placed during setup (practice walls, box fight boxes).
    for (const p of this.match.builds.pieces.values()) this.builds.add(p, -10);

    this.hud = new Hud(this.host.hudParent, s, this.host.save.data.keybinds);
    this.hud.setMap(new MapRenderer(this.match.world.map), `${this.match.world.map.name} · ${mode.name}`);
    this.nameplateLayer = h('div', { class: 'nameplates' });
    this.hud.root.appendChild(this.nameplateLayer);
    this.fx = new ClientEffects(this.match, this.effects, this.host.audio, this.hud, this.builds, this.camera, this.models, this.host.progression, () => this.renderTime);
    this.buildCtl = new BuildController(this.match, this.adapter, this.builds, s.gameplay);
    this.buildCtl.onNotice((t) => this.hud.banner(t.toUpperCase(), '', 1400));
    if (this.host.dev) {
      this.debug = new DebugOverlay(this.host.hudParent);
      this.scene.add(this.debug.group);
    }
    if (this.modeId === 'tutorial') this.tutorial = new Tutorial(this.hud.root, this.match, this.host.save.data.keybinds);
    this.wireMatchEvents();
    this.camera.yaw = this.match.human.yaw;
    for (const c of this.match.combatants) this.prevPos.set(c.id, c.pos.clone());
    progress(0.85, 'Compiling shaders');
    await nextFrame();
    try {
      this.updateCamera(0, 1);
      this.host.render.renderer.compile(this.scene, this.camera.camera);
    } catch (e) {
      log.warn('shader precompile failed (continuing)', e);
    }
    progress(1, 'Ready');
    this.host.audio.startAmbience();
    this.host.audio.music('match');
    log.info(`client ready: ${mode.name}`);
  }

  private setupLighting(): void {
    const v = this.settings.video;
    const map = this.match.world.map;
    const sunDir = new Vector3(-0.55, 0.62, -0.35).normalize();
    this.sky = new Sky(DAY_SKY, sunDir, 1800, v.effects === 'low' ? 8 : 18);
    this.scene.add(this.sky.group);
    this.scene.background = new Color(DAY_SKY.horizon);
    const fogScale = 320 / Math.max(150, v.viewDistance);
    this.scene.fog = new FogExp2(new Color(0xc9dcea), map.fogDensity * fogScale);
    this.scene.add(new HemisphereLight(0xcfe6ff, 0x5a5040, 1.25));
    this.scene.add(new AmbientLight(0xffffff, 0.18));
    this.sun = new DirectionalLight(0xffe2b8, 2.6);
    this.sun.position.copy(sunDir).multiplyScalar(120);
    const shadowSize = { off: 0, low: 1024, medium: 1536, high: 2048 }[v.shadows];
    if (shadowSize > 0) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const r = v.shadows === 'high' ? 70 : 50;
      const cam = this.sun.shadow.camera;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = 320;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun, this.sun.target);
  }

  applySettings(): void {
    const s = this.settings;
    this.camera.settings = {
      fov: s.video.fov,
      distance: s.gameplay.cameraDistance,
      shoulder: s.gameplay.shoulderOffset,
      shake: s.accessibility.screenShake,
      reducedMotion: s.accessibility.reducedMotion,
    };
    this.camera.camera.far = Math.max(300, s.video.viewDistance * 2.2);
    this.camera.camera.updateProjectionMatrix();
    this.hud?.applySettings(s);
    if (this.buildCtl) this.buildCtl.settings = s.gameplay;
    if (this.match) this.match.autoPickup = s.gameplay.autoPickup;
    this.host.input.rawInput = s.mouse.rawInput;
  }

  private modelFor(c: Combatant): CharacterModel {
    let m = this.models.get(c.id);
    if (!m) {
      m = new CharacterModel(c.cosmetics, this.settings.video.shadows !== 'off');
      this.models.set(c.id, m);
      this.scene.add(m.root);
    }
    return m;
  }

  private wireMatchEvents(): void {
    const ev = this.match.events;
    this.unsubs.push(
      ev.on('MATCH_ENDED', (e) => this.onMatchEnded(e.result)),
      ev.on('STORM_PHASE', (e) => {
        this.hud.banner(e.message, this.match.storm?.isFinal ? 'Move to safety now' : '', 3000);
        this.host.audio.stinger('storm');
        this.host.audio.announce(e.message.toLowerCase());
      }),
      ev.on('ROUND_STARTED', (e) => {
        this.hud.banner(`ROUND ${e.round}`, 'Get ready', 2500);
        this.host.audio.stinger('round');
      }),
      ev.on('ROUND_ENDED', (e) => {
        const winner = this.match.byId(e.winnerId);
        const you = e.winnerId === this.match.human.id;
        this.hud.banner(you ? 'ROUND WON' : 'ROUND LOST', winner ? `${winner.name} takes round ${e.round}` : 'Draw', 3000);
        this.host.audio.stinger(you ? 'round' : 'defeat');
      }),
      ev.on('PLAYER_ELIMINATED', (e) => {
        if (e.victimId === this.match.human.id) {
          this.buildCtl.cancelEdit();
          const killer = this.match.byId(e.killerId);
          this.spectateId = killer && killer.alive && killer !== this.match.human ? killer.id : -1;
        }
      }),
    );
  }

  // ------------------------------------------------------------------ loop

  frame(dt: number): void {
    if (this.disposed) return;
    this.renderTime += dt;
    this.fps = this.fps * 0.93 + (1 / Math.max(dt, 1e-4)) * 0.07;
    const input = this.host.input;
    input.beginFrame();
    this.handleGlobalKeys();
    if (!this.paused) {
      this.handleLook();
      this.handleActions();
      this.sendInput();
      // Fixed-step simulation with interpolation.
      this.accumulator += Math.min(dt, 0.25);
      let steps = 0;
      while (this.accumulator >= SIM_DT && steps < MAX_SIM_STEPS) {
        for (const c of this.match.combatants) {
          const p = this.prevPos.get(c.id);
          if (p) p.copy(c.pos);
          else this.prevPos.set(c.id, c.pos.clone());
        }
        this.adapter.step(SIM_DT);
        this.simTime += SIM_DT;
        this.accumulator -= SIM_DT;
        steps++;
      }
      if (steps === MAX_SIM_STEPS) this.accumulator = 0;
    }
    const alpha = this.paused ? 1 : Math.min(1, this.accumulator / SIM_DT);
    this.updateCamera(dt, alpha);
    if (!this.paused) this.updateBuilding();
    this.updateViews(dt, alpha);
    this.updateHud();
    this.debug?.update(this.match, this.camera, this.buildCtl.target, this.host.render.renderer, this.fps, this.renderTime);
    this.tutorial?.update(this.lastLookDelta, this.inventoryOpen);
    this.host.render.renderer.render(this.scene, this.camera.camera);
  }

  private handleGlobalKeys(): void {
    const input = this.host.input;
    if (input.pressed('menu') && !this.paused) this.host.requestPause();
    if (input.pressed('map')) this.hud.toggleBigMap();
    if (input.pressed('inventory')) this.toggleInventory();
    if (this.host.dev) this.handleDevKeys();
  }

  private handleDevKeys(): void {
    const input = this.host.input;
    const m = this.match;
    const h = m.human;
    if (input.codePressed('F1')) this.debug?.setVisible(!this.debug.visible);
    if (input.codePressed('F2')) {
      h.materials = { wood: 999, stone: 999, metal: 999 };
      this.hud.banner('DEV: MATERIALS', '', 900);
    }
    if (input.codePressed('F3')) {
      h.inventory.slots = [makeWeapon('shotgun', 'apex'), makeWeapon('ar', 'apex'), makeWeapon('smg', 'apex'), makeWeapon('marksman', 'apex'), { kind: 'consumable', id: 'shield_canister', count: 3 }] as SlotItem[];
      for (const a of AMMO_TYPES) h.inventory.ammo[a] = 300;
      this.hud.banner('DEV: ALL WEAPONS', '', 900);
    }
    if (input.codePressed('F4') && m.storm) {
      m.storm.active = !m.storm.active;
      this.hud.banner(`DEV: STORM ${m.storm.active ? 'ON' : 'PAUSED'}`, '', 900);
    }
    if (input.codePressed('F5')) {
      const dead = m.combatants.find((c) => c.isBot && !c.alive);
      if (dead) {
        dead.resetForRound();
        dead.shield = 50;
        const fwd = dirFromYawPitch(this.camera.yaw, 0, new Vector3());
        m.placeAt(dead, h.pos.x + fwd.x * 12, h.pos.z + fwd.z * 12);
        this.hud.banner(`DEV: SPAWNED ${dead.name.toUpperCase()}`, '', 900);
      }
    }
    if (input.codePressed('F6')) {
      for (const c of m.combatants) if (c.isBot && c.alive) m.applyDamage(c, 999, h, 'weapon', false, c.pos.clone(), 'dev');
      this.hud.banner('DEV: KILLED ALL BOTS', '', 900);
    }
    if (input.codePressed('F7')) {
      m.builds.resetAll();
      if (m.mode.training) m.buildTrainingStructures();
      this.hud.banner('DEV: BUILDS RESET', '', 900);
    }
  }

  private sensitivity(): number {
    const s = this.settings.mouse;
    const h = this.match.human;
    let mult = 1;
    if (h.buildPiece !== null || this.buildCtl.editing) mult = s.buildMult;
    else if (h.input.aim && h.inventory.currentWeapon()) mult = WEAPONS[h.inventory.currentWeapon()!.id].scoped ? s.scopeMult : s.adsMult;
    return mult;
  }

  private handleLook(): void {
    const input = this.host.input;
    const s = this.settings.mouse;
    let dx = input.mouseDX;
    let dy = input.mouseDY;
    if (s.acceleration) {
      const speed = Math.hypot(dx, dy);
      const k = 1 + Math.min(1.5, speed / 60);
      dx *= k;
      dy *= k;
    }
    const base = 0.0022 * this.sensitivity();
    const yawDelta = dx * base * s.sensX;
    const pitchDelta = dy * base * s.sensY * (s.invertY ? -1 : 1);
    this.lastLookDelta = Math.abs(yawDelta) + Math.abs(pitchDelta);
    this.camera.addLook(yawDelta, pitchDelta);
  }

  private pieceKey(): BuildPieceType | null {
    const input = this.host.input;
    if (input.pressed('wall')) return 'wall';
    if (input.pressed('floor')) return 'floor';
    if (input.pressed('ramp')) return 'ramp';
    if (input.pressed('roof')) return 'cone';
    return null;
  }

  private handleActions(): void {
    const input = this.host.input;
    const m = this.match;
    const h = m.human;
    const send = (a: Parameters<LocalGameAdapter['sendAction']>[0]) => this.adapter.sendAction(a);
    const ray = this.cameraRay();

    // Spectating
    if (!h.alive) {
      if (input.pressed('fire')) this.cycleSpectate();
      return;
    }
    // Deployment
    if (h.air === 'bus') {
      if (input.pressed('jump')) send({ type: 'jumpFromBus' });
      return;
    }
    if (h.air === 'skydive' || h.air === 'glide') {
      if (input.pressed('jump')) send({ type: 'toggleGlider' });
      return;
    }
    // Practice keys
    if (m.mode.training) {
      if (input.pressed('practiceReset')) send({ type: 'resetBuilds' });
      if (input.pressed('practiceRespawn')) send({ type: 'respawn' });
    }

    // Edit mode has priority.
    if (this.buildCtl.editing) {
      const gp = this.settings.gameplay;
      if (input.pressed('resetEdit')) {
        this.buildCtl.resetEdit();
        return;
      }
      if (input.pressed('edit')) {
        this.buildCtl.commitEdit();
        return;
      }
      if (input.released('edit') && (gp.holdToEdit || (gp.editOnRelease && this.renderTime - this.ePressedAt > 0.2 && this.buildCtl.editChanged()))) {
        this.buildCtl.commitEdit();
        return;
      }
      const cancel = this.slotKeyPressed() || this.pieceKey();
      if (cancel) this.buildCtl.cancelEdit();
      else {
        const viewer = this.camera.camera.position.clone();
        this.buildCtl.updateEdit(ray, { pressed: input.pressed('fire'), held: input.held('fire'), released: input.released('fire') }, viewer);
        return;
      }
    }

    // Build piece selection
    const piece = this.pieceKey();
    if (piece) {
      this.lastBuildPiece = piece;
      send({ type: 'selectBuild', piece });
    }
    if (input.pressed('toggleBuild')) {
      if (h.buildPiece) send({ type: 'exitBuild' });
      else send({ type: 'selectBuild', piece: this.lastBuildPiece });
    }
    if (input.pressed('cycleMaterial')) send({ type: 'cycleMaterial' });

    // R: rotate in build mode, reload otherwise.
    if (h.buildPiece !== null) {
      if (input.pressed('rotate')) send({ type: 'rotateBuild' });
    } else if (input.pressed('reload')) send({ type: 'reload' });

    // Slots
    const slot = this.slotKeyPressed();
    if (slot !== null) send({ type: 'selectSlot', slot });
    if (input.pressed('pickaxe')) send({ type: 'selectPickaxe' });
    if (input.pressed('nextWeapon')) send({ type: 'cycleWeapon', delta: 1 });
    if (input.pressed('prevWeapon')) send({ type: 'cycleWeapon', delta: -1 });
    if (input.pressed('emote')) send({ type: 'emote', emoteId: this.host.save.data.profile.equipped.emote });

    // E: interact when something interactable is in front, otherwise edit.
    const eEdit = input.pressed('edit');
    const eInteract = input.pressed('interact');
    if (eEdit || eInteract) {
      const interactable = h.buildPiece === null ? m.findInteractable(h) : null;
      if (eInteract && interactable) send({ type: 'interact' });
      else if (eEdit && this.buildCtl.beginEdit(ray, this.renderTime)) {
        this.ePressedAt = this.renderTime;
        this.host.audio.sfx('edit', undefined, 0.4);
      }
    }
  }

  private slotKeyPressed(): number | null {
    const input = this.host.input;
    for (let i = 0; i < 5; i++) if (input.pressed(`slot${i + 1}` as 'slot1')) return i;
    return null;
  }

  private sendInput(): void {
    const input = this.host.input;
    const h = this.match.human;
    const gp = this.settings.gameplay;
    const pi: PlayerInput = emptyInput();
    const alive = h.alive;
    if (alive) {
      pi.forward = (input.held('forward') ? 1 : 0) - (input.held('backward') ? 1 : 0);
      pi.right = (input.held('right') ? 1 : 0) - (input.held('left') ? 1 : 0);
      pi.jump = input.held('jump') && h.air === 'none';
      if (gp.sprintByDefault) pi.sprint = !input.held('sprint');
      else {
        if (input.pressed('sprint') && this.sprintToggle) this.sprintToggle = false;
        pi.sprint = input.held('sprint');
      }
      if (gp.toggleCrouch) {
        if (input.pressed('crouch')) this.crouchToggled = !this.crouchToggled;
        pi.crouch = this.crouchToggled;
      } else pi.crouch = input.held('crouch');
      const building = h.buildPiece !== null || this.buildCtl.editing;
      pi.fire = !building && input.held('fire');
      pi.aim = !building && input.held('aim');
    }
    pi.yaw = this.camera.aimYaw;
    pi.pitch = this.camera.aimPitch;
    const ray = this.cameraRay();
    pi.rayOrigin = { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z };
    pi.rayDir = { x: ray.dir.x, y: ray.dir.y, z: ray.dir.z };
    this.adapter.sendInput(pi);
  }

  private cameraRay(): CameraRay {
    return this.camera.ray();
  }

  private updateBuilding(): void {
    const input = this.host.input;
    if (this.buildCtl.editing || !this.match.human.alive) {
      this.buildCtl.updateTarget(this.cameraRay());
      return;
    }
    this.buildCtl.updateTarget(this.cameraRay());
    this.buildCtl.handleFire(input.pressed('fire'), input.held('fire'));
  }

  private cycleSpectate(): void {
    const alive = this.match.combatants.filter((c) => c.alive && c !== this.match.human);
    if (!alive.length) return;
    const i = alive.findIndex((c) => c.id === this.spectateId);
    this.spectateId = alive[(i + 1) % alive.length].id;
  }

  private interpolated(c: Combatant, alpha: number, out = new Vector3()): Vector3 {
    const p = this.prevPos.get(c.id);
    if (!p || p.distanceToSquared(c.pos) > 25) return out.copy(c.pos);
    return out.lerpVectors(p, c.pos, alpha);
  }

  private updateCamera(dt: number, alpha: number): void {
    const m = this.match;
    const h = m.human;
    // Recoil from the simulation feeds the camera (visual + aim).
    if (h.recoilPitch || h.recoilYaw) {
      this.camera.addRecoil(h.recoilPitch, h.recoilYaw);
      h.recoilPitch = 0;
      h.recoilYaw = 0;
    }
    let focus: Combatant = h;
    if (!h.alive) {
      let target = m.byId(this.spectateId);
      if (!target || !target.alive) {
        target = m.combatants.find((c) => c.alive && c !== h) ?? null;
        this.spectateId = target?.id ?? -1;
      }
      if (target) {
        focus = target;
        this.camera.yaw += (target.yaw - this.camera.yaw) * Math.min(1, dt * 4);
      }
    }
    const pos = this.interpolated(focus, alpha);
    if (focus.air === 'bus' && m.bus) pos.copy(m.bus.pos);
    this.camera.distanceOverride = focus.air === 'bus' ? 20 : focus.air === 'skydive' ? 7 : focus.air === 'glide' ? 6 : null;
    const w = focus.inventory.currentWeapon();
    const aiming = focus === h && h.input.aim && !!w && h.buildPiece === null;
    const scoped = aiming && !!w && WEAPONS[w.id].scoped;
    this.camera.update(dt, pos, focus.crouching ? 1.15 : EYE_HEIGHT, {
      aiming,
      scoped,
      adsFov: w ? WEAPONS[w.id].adsFov : 1,
      sprinting: focus.sprinting && focus.grounded,
      world: m.world.collision,
    });
  }

  private animState(c: Combatant): AnimState {
    const w = c.inventory.current;
    let held: HeldItem = 'none';
    if (c.buildPiece !== null || c.editingPieceId >= 0) held = 'build';
    else if (c.inventory.selected === 'pickaxe') held = 'pickaxe';
    else if (w?.kind === 'weapon') held = w.id;
    else if (w?.kind === 'consumable') held = 'consumable';
    const t = this.match.time;
    return {
      speed: Math.hypot(c.vel.x, c.vel.z),
      grounded: c.grounded,
      crouch: c.crouching,
      sliding: c.slideTimer > 0,
      air: c.air,
      pitch: c.pitch,
      sinceShot: t - c.lastShotAt,
      reloading: c.reloadTimer > 0,
      sinceSwing: t - c.lastSwingAt,
      sinceBuild: t - c.lastBuildAt,
      usingItem: c.useTimer > 0,
      emote: c.emoteTimer > 0 ? emoteAnim(c.emoteId) : null,
      emoteTime: 5 - c.emoteTimer,
      dead: !c.alive,
      sinceDeath: t - c.deathTime,
      held,
      aiming: c.input.aim,
      strafe: 0,
    };
  }

  private updateViews(dt: number, alpha: number): void {
    const m = this.match;
    const cam = this.camera.camera;
    const t = this.renderTime;
    const tmp = new Vector3();
    for (const c of m.combatants) {
      const model = this.modelFor(c);
      const gone = !c.alive && m.time - c.deathTime > 2.2;
      model.root.visible = c.air !== 'bus' && !gone && !(c === m.human && this.camera.camera.position.distanceTo(c.eye(tmp)) < 0.45);
      if (!model.root.visible) continue;
      this.interpolated(c, alpha, model.root.position);
      model.root.rotation.y = c.yaw;
      model.update(dt, this.animState(c));
      // Footsteps
      if (c.grounded && c.alive && Math.hypot(c.vel.x, c.vel.z) > 1.5) {
        if (c === m.human) {
          this.footstepTimer -= dt * Math.hypot(c.vel.x, c.vel.z);
          if (this.footstepTimer <= 0) {
            this.footstepTimer = 2.4;
            this.host.audio.sfx('footstep', undefined, 0.5);
          }
        } else if (Math.random() < dt * 2.2 && model.root.position.distanceTo(cam.position) < 25) this.host.audio.sfx('footstep', c.pos, 0.6);
      }
    }
    this.updateNameplates();
    this.builds.update(t, m.builds.pieces);
    this.loot.update(m.world.items, m.targets, m.time);
    const focus = this.camera.camera.position;
    this.world.update(m.time, focus);
    this.stormView.update(m.storm, t, 0);
    this.busView.group.visible = !!m.bus && (m.phase === 'WARMUP' || m.phase === 'DEPLOYMENT');
    if (this.busView.group.visible && m.bus) {
      this.busView.group.position.copy(m.bus.pos);
      this.busView.group.rotation.y = Math.atan2(-m.bus.dir.x, -m.bus.dir.z);
      this.busView.update(t);
    }
    this.effects.update(dt, cam.quaternion);
    this.sky.update(dt, cam.position);
    // Shadow camera follows the view.
    const h = m.human.alive ? m.human.pos : cam.position;
    this.sun.target.position.set(h.x, 0, h.z);
    this.sun.position.set(h.x - 55, 90, h.z - 35);
    // Audio listener & ambience
    this.host.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.camera.yaw);
    this.updateAmbience();
  }

  private updateAmbience(): void {
    const m = this.match;
    const p = this.camera.camera.position;
    let hum = 0;
    let water = 0;
    for (const poi of m.world.map.pois) {
      const d = Math.hypot(p.x - poi.x, p.z - poi.z);
      if (poi.id === 'ironworks' || poi.id === 'skyline') hum = Math.max(hum, 1 - d / 70);
      if (poi.id === 'pinewater') water = Math.max(water, 1 - d / 60);
    }
    let storm = 0;
    if (m.storm) {
      const d = m.storm.distanceOutside(p.x, p.z);
      storm = d > 0 ? 1 : Math.max(0, 1 + d / 25);
    }
    const alt = Math.max(0, (p.y - m.world.collision.terrainHeight(p.x, p.z)) / 60);
    this.host.audio.updateAmbience({ wind: Math.min(1, 0.35 + alt), hum: Math.max(0, hum), storm, water: Math.max(0, water), birds: !m.mode.training && storm < 0.3 && m.world.map.id !== 'duel_arena' });
  }

  /** Enemy nameplates only when visible (line of sight) and close. */
  private updateNameplates(): void {
    const m = this.match;
    const cam = this.camera.camera;
    const w = window.innerWidth;
    const hh = window.innerHeight;
    const v = new Vector3();
    for (const c of m.combatants) {
      if (c === m.human) continue;
      let np = this.nameplates.get(c.id);
      if (!np) {
        np = { el: h('div', { class: 'nameplate' }, c.name), visible: false, checkAt: 0 };
        this.nameplateLayer.appendChild(np.el);
        this.nameplates.set(c.id, np);
      }
      const d = c.pos.distanceTo(cam.position);
      let show = c.alive && c.air === 'none' && d < 45;
      if (show && this.renderTime >= np.checkAt) {
        np.checkAt = this.renderTime + 0.2;
        np.visible = m.world.collision.lineOfSight(cam.position, c.eye(v));
      }
      show = show && np.visible;
      if (show) {
        v.set(c.pos.x, c.pos.y + c.height + 0.45, c.pos.z).project(cam);
        if (v.z > 1) show = false;
        else np.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hh}px) translate(-50%, -100%)`;
      }
      if (np.el.classList.contains('show') !== show) np.el.classList.toggle('show', show);
    }
  }

  private updateHud(): void {
    const m = this.match;
    const h = m.human;
    const inv = h.inventory;
    const w = inv.currentWeapon();
    const cur = inv.current;
    const storm = m.storm;
    const target = this.buildCtl.target;
    const inter = h.alive && h.buildPiece === null && !this.buildCtl.editing ? m.findInteractable(h) : null;
    const eKey = this.host.save.data.keybinds.interact[0];
    let spread = 0;
    if (w) {
      const def = WEAPONS[w.id];
      spread = (h.input.aim ? def.spreadAds : def.spreadHip) + h.bloom + def.spreadMoving * Math.min(1, Math.hypot(h.vel.x, h.vel.z) / 6);
    }
    let deployHint = '';
    const k = (a: 'jump') => this.host.save.data.keybinds[a][0]?.replace('Key', '') ?? '';
    if (h.alive) {
      if (h.air === 'bus') deployHint = m.phase === 'DEPLOYMENT' ? `[${k('jump').toUpperCase()}] JUMP` : '';
      else if (h.air === 'skydive') deployHint = `[${k('jump').toUpperCase()}] OPEN GLIDER`;
      else if (h.air === 'glide') deployHint = `[${k('jump').toUpperCase()}] CLOSE GLIDER`;
    }
    // Phase banners
    if (m.phase !== this.lastPhase) {
      this.lastPhase = m.phase;
      if (m.phase === 'DEPLOYMENT') {
        this.hud.banner('DEPLOY', 'Jump from the Skybarge whenever you are ready', 3000);
        this.host.audio.announce('Deployment has begun');
      }
      if (m.phase === 'ACTIVE' && m.mode.id !== 'br' && !m.mode.training) this.hud.banner('FIGHT!', '', 1200);
    }
    if (m.phase === 'WARMUP') {
      const n = Math.ceil(m.phaseTimer);
      if (n !== this.lastCountdown) {
        this.lastCountdown = n;
        if (m.mode.id === 'br') this.hud.banner(m.world.map.name.toUpperCase(), `Players: ${m.totalPlayers} · Deployment in: ${n}`, 0);
        else this.hud.banner(`ROUND ${m.round}`, `Starting in ${n}`, 0);
        this.host.audio.ui('tick');
      }
    } else if (this.lastCountdown !== -1) {
      this.lastCountdown = -1;
      if (m.phase !== 'ROUND_END') this.hud.hideBanner();
    }
    const reserve = m.reserveFor(h);
    let roundText = '';
    if (m.isRoundMode) {
      const opp = m.combatants.filter((c) => c !== h).sort((a, b) => b.roundWins - a.roundWins)[0];
      roundText = m.mode.maxPlayers === 2 && opp ? `ROUND ${m.round} · YOU ${h.roundWins} — ${opp.roundWins} ${opp.name.toUpperCase()} · FIRST TO ${m.mode.roundsToWin}` : `ROUND ${m.round} · YOUR WINS ${h.roundWins} / ${m.mode.roundsToWin}`;
    }
    const specTarget = !h.alive ? m.byId(this.spectateId) : null;
    this.hud.frame(
      {
        health: h.health,
        shield: h.shield,
        slots: inv.slots,
        selected: inv.selected,
        reserve,
        reloadProgress: h.reloadTimer > 0 && w ? 1 - h.reloadTimer / Math.max(0.01, WEAPONS[w.id].reloadPerShell || WEAPONS[w.id].reloadTime) : null,
        useProgress: h.useTimer > 0 && cur?.kind === 'consumable' ? 1 - h.useTimer / CONSUMABLES[cur.id].useTime : null,
        useLabel: cur?.kind === 'consumable' ? `USING ${CONSUMABLES[cur.id].name.toUpperCase()}` : '',
        materials: h.materials,
        unlimitedMaterials: h.unlimitedMaterials,
        buildMaterial: h.buildMaterial,
        buildPiece: h.buildPiece,
        buildInvalidReason: target && !target.valid && target.reason !== 'Blocked by existing structure' ? target.reason : '',
        editing: this.buildCtl.editing,
        alive: m.aliveCount,
        eliminations: h.stats.eliminations,
        interactLabel: inter ? `[${eKey.replace('Key', '')}] ${inter.label}` : null,
        storm,
        stormInside: !storm || storm.isInside(h.pos.x, h.pos.z),
        stormDistance: storm ? storm.distanceOutside(h.pos.x, h.pos.z) : 0,
        stormActive: !!storm && m.phase !== 'WARMUP' && m.phase !== 'DEPLOYMENT',
        fps: this.fps,
        spread,
        scoped: this.camera.zoomFactor < 0.5,
        aiming: h.input.aim,
        player: { x: (specTarget ?? h).pos.x, z: (specTarget ?? h).pos.z, yaw: this.camera.yaw },
        roundText,
        deployHint,
        training: m.mode.training,
        spectating: specTarget ? specTarget.name : null,
        bus: m.phase === 'DEPLOYMENT' || m.phase === 'WARMUP' ? m.bus : null,
        lowHealth: h.alive && h.health < 30,
        others: this.host.dev ? m.combatants.filter((c) => c !== h && c.alive).map((c) => ({ x: c.pos.x, z: c.pos.z, yaw: c.yaw })) : [],
      },
      this.camera.camera,
      this.renderTime,
      this.settings.gameplay.showPing,
    );
    if (this.hud.bigMapOpen) {
      this.hud.setScoreboard(
        [...m.combatants]
          .filter((c) => !m.brains.some((b) => b.self === c && b.role === 'dummy'))
          .sort((a, b) => Number(b.alive) - Number(a.alive) || b.stats.eliminations - a.stats.eliminations)
          .map((c) => ({ name: c === h ? `${c.name} (YOU)` : c.name, elims: c.stats.eliminations, alive: c.alive, self: c === h, extra: m.isRoundMode ? `${c.roundWins} RW` : undefined })),
      );
    }
  }

  // ------------------------------------------------------------------ inventory

  toggleInventory(open = !this.inventoryOpen): void {
    this.inventoryOpen = open;
    if (!open) {
      this.inventoryEl?.remove();
      this.inventoryEl = null;
      return;
    }
    const me = this.match.human;
    const canDrop = this.match.mode.id === 'br';
    const el = h('div', { class: 'inventory-panel panel-glass' },
      h('div', { class: 'inv-title' }, 'INVENTORY'),
      h('div', { class: 'inv-slots' },
        me.inventory.slots.map((s, i) => h('div', { class: 'inv-slot', style: s ? `--rarity:${RARITY_INFO[itemRarity(s)].color}` : '' },
          h('div', { class: 'inv-slot-key' }, String(i + 1)),
          h('div', { class: 'inv-slot-name' }, s ? itemLabel(s) : 'Empty'),
          s && s.kind === 'weapon' ? h('div', { class: 'inv-slot-sub' }, `${s.ammoInMag}/${WEAPONS[s.id].magSize} · ${Math.round(WEAPONS[s.id].damage)} dmg`) : null,
          s && canDrop ? h('button', { class: 'btn btn-ghost btn-xs', onclick: () => { this.adapter.sendAction({ type: 'dropSlot', slot: i }); setTimeout(() => this.toggleInventory(true), 50); } }, 'DROP') : null,
        )),
      ),
      h('div', { class: 'inv-ammo' }, AMMO_TYPES.map((a) => h('div', {}, h('span', {}, AMMO_LABEL[a].toUpperCase()), h('b', {}, me.unlimitedAmmo ? '∞' : String(me.inventory.ammo[a]))))),
      h('div', { class: 'inv-ammo' }, (['wood', 'stone', 'metal'] as const).map((mat) => h('div', {}, h('span', {}, mat.toUpperCase()), h('b', {}, me.unlimitedMaterials ? '∞' : String(me.materials[mat]))))),
      h('div', { class: 'inv-hint' }, `Press ${this.host.save.data.keybinds.inventory[0]} to close${canDrop ? ' · unlock the mouse (ESC) to drop items' : ''}`),
    );
    this.inventoryEl?.remove();
    this.inventoryEl = el;
    this.hud.root.appendChild(el);
  }

  // ------------------------------------------------------------------ end / lifecycle

  private onMatchEnded(result: MatchResult): void {
    if (this.endReported) return;
    this.endReported = true;
    this.ended = true;
    this.summary = this.host.progression.recordMatch(result);
    this.host.audio.stinger(result.won ? 'victory' : 'defeat');
    this.host.audio.announce(result.won ? 'Match won' : 'Eliminated');
    setTimeout(() => this.host.matchEnded(result, this.summary), result.won ? 1800 : 1400);
  }

  /** Leaving mid-match (pause → return to lobby). Returns a result for non-training modes. */
  abandon(): MatchResult | null {
    if (this.ended || this.match.mode.training) return null;
    const m = this.match;
    const h = m.human;
    const result: MatchResult = {
      mode: m.mode.id,
      modeName: m.mode.name,
      won: false,
      placement: h.alive ? m.aliveCount : h.placement,
      totalPlayers: m.totalPlayers,
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
      roundsWon: h.roundWins,
      roundsLost: Math.max(0, m.round - h.roundWins),
      timestamp: Date.now(),
    };
    this.ended = true;
    this.host.progression.recordMatch(result);
    return result;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  get lastSummary(): MatchSummary | null {
    return this.summary;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.match.paused = p;
    if (p) {
      this.buildCtl.cancelEdit();
      this.host.input.clear();
    }
  }

  onResize(): void {
    this.camera.camera.aspect = this.host.render.aspect;
    this.camera.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.unsubs) u();
    this.fx?.dispose();
    this.tutorial?.dispose();
    this.debug?.dispose();
    this.hud?.dispose();
    this.inventoryEl?.remove();
    for (const m of this.models.values()) m.dispose();
    this.models.clear();
    this.world?.dispose();
    this.builds?.dispose();
    this.effects?.dispose();
    this.stormView?.dispose();
    this.loot?.dispose();
    this.busView?.dispose();
    this.sky?.dispose();
    this.adapter?.disconnect();
    this.match?.dispose();
    this.scene.clear();
    this.host.audio.stopAmbience();
  }
}
