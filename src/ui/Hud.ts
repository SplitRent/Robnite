import { Vector3, type PerspectiveCamera } from 'three';
import { h, setText, setStyle, toggle, clear } from './dom';
import { ICONS, consumableIcon, pieceIcon, weaponIcon } from './icons';
import { formatTime } from '../core/math';
import { RARITY_INFO, CONSUMABLES, AMMO_LABEL, type SlotItem, itemRarity } from '../inventory/items';
import { WEAPONS } from '../weapons/weapons';
import type { Settings } from '../settings/settings';
import { codeLabel, type KeybindConfig } from '../input/bindings';
import type { BuildMaterial, BuildPieceType } from '../building/grid';
import { MapRenderer, type MapMarker } from './Minimap';
import type { Storm } from '../storm/Storm';
import type { BusState } from '../game/Match';

export interface HudFrame {
  health: number;
  shield: number;
  slots: (SlotItem | null)[];
  selected: number | 'pickaxe';
  reserve: number | null;
  reloadProgress: number | null;
  useProgress: number | null;
  useLabel: string;
  materials: Record<BuildMaterial, number>;
  unlimitedMaterials: boolean;
  buildMaterial: BuildMaterial;
  buildPiece: BuildPieceType | null;
  buildInvalidReason: string;
  editing: boolean;
  alive: number;
  eliminations: number;
  interactLabel: string | null;
  storm: Storm | null;
  stormInside: boolean;
  stormDistance: number;
  stormActive: boolean;
  fps: number;
  spread: number;
  scoped: boolean;
  aiming: boolean;
  player: { x: number; z: number; yaw: number };
  roundText: string;
  deployHint: string;
  training: boolean;
  spectating: string | null;
  bus: BusState | null;
  lowHealth: boolean;
  others: MapMarker[];
}

interface DmgNum {
  el: HTMLElement;
  pos: Vector3;
  born: number;
  vy: number;
}

/** In-match HUD. DOM is created once and updated with minimal writes. */
export class Hud {
  readonly root: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private pieceEls: Record<BuildPieceType, HTMLElement> = {} as Record<BuildPieceType, HTMLElement>;
  private matEls: Record<BuildMaterial, HTMLElement> = {} as Record<BuildMaterial, HTMLElement>;
  private minimapCtx: CanvasRenderingContext2D;
  private bigMapCtx: CanvasRenderingContext2D;
  private mapRenderer: MapRenderer | null = null;
  private dmgNums: DmgNum[] = [];
  private killFeed: HTMLElement;
  private xpFeed: HTMLElement;
  private pickupFeed: HTMLElement;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private hitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMinimap = 0;
  private lastSlotsKey = '';
  bigMapOpen = false;
  private scoreboard: HTMLElement;

  constructor(parent: HTMLElement, private settings: Settings, private bindings: KeybindConfig) {
    const e = this.els;
    const key = (a: keyof KeybindConfig) => codeLabel(this.bindings[a]?.[0]);
    this.root = h('div', { class: 'hud', id: 'hud' },
      // Top-left: debug / training / connection
      e.info = h('div', { class: 'hud-info' }),
      e.training = h('div', { class: 'hud-training panel-glass' },
        h('div', { class: 'hud-training-title' }, 'BUILD PRACTICE'),
        h('div', {}, 'Materials: ∞'), h('div', {}, 'Ammo: ∞'),
        e.trainHp = h('div', {}, 'Health: 100'), e.trainSh = h('div', {}, 'Shield: 100'),
        h('div', { class: 'hud-training-keys' }, `[${key('practiceReset')}] Reset builds · [${key('practiceRespawn')}] Respawn`),
      ),
      // Top-centre
      h('div', { class: 'hud-top' },
        e.counts = h('div', { class: 'hud-counts' },
          h('span', { class: 'hud-count' }, h('b', {}, e.aliveNum = h('span', {}, '0')), ' ALIVE'),
          h('span', { class: 'hud-count' }, h('b', {}, e.elimNum = h('span', {}, '0')), ' ELIMS'),
        ),
        e.round = h('div', { class: 'hud-round' }),
        e.stormBox = h('div', { class: 'hud-storm' }, e.stormLabel = h('div', { class: 'hud-storm-label' }), e.stormTime = h('div', { class: 'hud-storm-time' })),
      ),
      // Top-right: minimap
      e.minimapWrap = h('div', { class: 'hud-minimap' }, e.minimap = h('canvas', { width: 190, height: 190 }), e.minimapAlive = h('div', { class: 'hud-minimap-alive' })),
      this.killFeed = h('div', { class: 'hud-killfeed' }),
      // Centre
      e.banner = h('div', { class: 'hud-banner' }, e.bannerTitle = h('div', { class: 'hud-banner-title' }), e.bannerSub = h('div', { class: 'hud-banner-sub' })),
      e.crosshair = h('div', { class: 'crosshair' }, h('i', { class: 'ch-t' }), h('i', { class: 'ch-b' }), h('i', { class: 'ch-l' }), h('i', { class: 'ch-r' }), h('i', { class: 'ch-dot' })),
      e.hitmarker = h('div', { class: 'hitmarker' }, h('i'), h('i'), h('i'), h('i')),
      e.scope = h('div', { class: 'scope' }),
      e.dmgLayer = h('div', { class: 'dmg-layer' }),
      e.prompt = h('div', { class: 'hud-prompt' }),
      e.buildHint = h('div', { class: 'hud-buildhint' }),
      e.editHint = h('div', { class: 'hud-edithint' }, `EDIT · drag to select · release to confirm · [${key('resetEdit')}] reset · [ESC] cancel`),
      e.progress = h('div', { class: 'hud-progress' }, e.progressLabel = h('div', { class: 'hud-progress-label' }), h('div', { class: 'hud-progress-bar' }, e.progressFill = h('div', { class: 'hud-progress-fill' }))),
      e.deploy = h('div', { class: 'hud-deploy' }),
      e.spectate = h('div', { class: 'hud-spectate' }),
      this.xpFeed = h('div', { class: 'hud-xpfeed' }),
      this.pickupFeed = h('div', { class: 'hud-pickups' }),
      e.elimPop = h('div', { class: 'hud-elim' }),
      e.subtitle = h('div', { class: 'hud-subtitle' }),
      // Bottom-left: vitals
      e.vitals = h('div', { class: 'hud-vitals' },
        e.shieldRow = h('div', { class: 'vital vital-shield' }, h('span', { class: 'vital-icon', html: ICONS.shield }), h('div', { class: 'vital-bar' }, e.shieldFill = h('div', { class: 'vital-fill' })), e.shieldNum = h('span', { class: 'vital-num' }, '0')),
        e.healthRow = h('div', { class: 'vital vital-health' }, h('span', { class: 'vital-icon', html: ICONS.heart }), h('div', { class: 'vital-bar' }, e.healthFill = h('div', { class: 'vital-fill' })), e.healthNum = h('span', { class: 'vital-num' }, '100')),
      ),
      // Bottom-centre: build bar + slots
      h('div', { class: 'hud-bottom' },
        e.buildBar = h('div', { class: 'hud-buildbar' },
          (['wall', 'floor', 'ramp', 'cone'] as BuildPieceType[]).map((p) => {
            const action = p === 'cone' ? 'roof' : p;
            this.pieceEls[p] = h('div', { class: 'build-piece' }, h('span', { class: 'build-piece-icon', html: pieceIcon(p) }), h('span', { class: 'build-piece-key' }, key(action as keyof KeybindConfig)));
            return this.pieceEls[p];
          }),
        ),
        e.slots = h('div', { class: 'hud-slots' }),
      ),
      // Bottom-right: materials + ammo
      h('div', { class: 'hud-br' },
        e.mats = h('div', { class: 'hud-mats' },
          (['wood', 'stone', 'metal'] as BuildMaterial[]).map((m) => {
            this.matEls[m] = h('div', { class: 'hud-mat' }, h('span', { class: 'hud-mat-icon', html: ICONS[m] }), h('span', { class: 'hud-mat-num' }, '0'));
            return this.matEls[m];
          }),
        ),
        e.ammo = h('div', { class: 'hud-ammo' }, e.ammoMag = h('span', { class: 'hud-ammo-mag' }), e.ammoRes = h('span', { class: 'hud-ammo-res' }), e.ammoName = h('div', { class: 'hud-ammo-name' })),
      ),
      e.vignette = h('div', { class: 'hud-vignette' }),
      e.stormVignette = h('div', { class: 'hud-storm-vignette' }),
      e.dmgDir = h('div', { class: 'hud-dmgdir' }),
      // Big map overlay
      e.bigmap = h('div', { class: 'hud-bigmap' },
        h('div', { class: 'bigmap-inner panel-glass' },
          e.bigmapTitle = h('div', { class: 'bigmap-title' }),
          h('div', { class: 'bigmap-body' },
            e.bigmapCanvas = h('canvas', { width: 620, height: 620 }),
            this.scoreboard = h('div', { class: 'scoreboard' }),
          ),
          h('div', { class: 'bigmap-hint' }, `[${key('map')}] close`),
        ),
      ),
    );
    parent.appendChild(this.root);
    this.minimapCtx = (e.minimap as HTMLCanvasElement).getContext('2d')!;
    this.bigMapCtx = (e.bigmapCanvas as HTMLCanvasElement).getContext('2d')!;
    this.applySettings(settings);
  }

  setMap(renderer: MapRenderer, title: string): void {
    this.mapRenderer = renderer;
    setText(this.els.bigmapTitle, title.toUpperCase());
  }

  applySettings(s: Settings): void {
    this.settings = s;
    const hud = s.hud;
    toggle(this.els.minimapWrap, 'hidden', !hud.minimap);
    toggle(this.els.ammo, 'hidden', !hud.ammo);
    toggle(this.els.healthRow, 'hidden', !hud.health);
    toggle(this.els.shieldRow, 'hidden', !hud.shield);
    toggle(this.els.slots, 'hidden', !hud.inventory);
    toggle(this.els.stormBox, 'hidden-setting', !hud.stormTimer);
    toggle(this.killFeed, 'hidden', !hud.killFeed);
    toggle(this.els.crosshair, 'hidden', !hud.crosshair);
    this.root.style.setProperty('--hud-scale', String(hud.scale));
    const c = s.crosshair;
    const ch = this.els.crosshair;
    ch.style.setProperty('--ch-size', `${c.size}px`);
    ch.style.setProperty('--ch-thick', `${c.thickness}px`);
    ch.style.setProperty('--ch-gap', `${c.gap}px`);
    ch.style.setProperty('--ch-color', c.color);
    ch.style.setProperty('--ch-opacity', String(c.opacity));
    toggle(ch, 'ch-outline', c.outline);
    toggle(ch, 'ch-nodot', !c.dot);
  }

  // ------------------------------------------------------------ transient feedback

  hitmarker(headshot: boolean, kill: boolean): void {
    if (!this.settings.gameplay.hitMarkers) return;
    const el = this.els.hitmarker;
    el.classList.remove('show', 'head', 'kill');
    void el.offsetWidth;
    el.classList.add('show');
    if (headshot) el.classList.add('head');
    if (kill) el.classList.add('kill');
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => el.classList.remove('show'), 160);
  }

  damageNumber(pos: Vector3, amount: number, headshot: boolean, shield: boolean, now: number): void {
    if (!this.settings.gameplay.damageNumbers) return;
    if (this.dmgNums.length > 14) this.dmgNums.shift()!.el.remove();
    const el = h('div', { class: `dmg-num ${headshot ? 'dmg-head' : ''} ${shield ? 'dmg-shield' : ''}` }, String(amount));
    this.els.dmgLayer.appendChild(el);
    this.dmgNums.push({ el, pos: pos.clone().add(new Vector3((Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4)), born: now, vy: 1.2 });
  }

  killfeed(html: string): void {
    const el = h('div', { class: 'kf-row', html });
    this.killFeed.prepend(el);
    while (this.killFeed.childElementCount > 5) this.killFeed.lastElementChild?.remove();
    setTimeout(() => {
      el.classList.add('fade');
      setTimeout(() => el.remove(), 500);
    }, 5000);
  }

  xp(amount: number, label: string): void {
    const el = h('div', { class: 'xp-row' }, h('b', {}, `+${amount} XP`), ' ', label.toUpperCase());
    this.xpFeed.prepend(el);
    while (this.xpFeed.childElementCount > 4) this.xpFeed.lastElementChild?.remove();
    setTimeout(() => el.remove(), 2600);
  }

  pickup(text: string, color: string): void {
    const el = h('div', { class: 'pickup-row', style: `border-color:${color}` }, text);
    this.pickupFeed.appendChild(el);
    while (this.pickupFeed.childElementCount > 4) this.pickupFeed.firstElementChild?.remove();
    setTimeout(() => el.remove(), 2200);
  }

  elimination(name: string): void {
    const el = this.els.elimPop;
    clear(el);
    el.append(h('div', { class: 'elim-title' }, 'ELIMINATION'), h('div', { class: 'elim-sub' }, name.toUpperCase()));
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  banner(title: string, sub = '', ms = 2500): void {
    const e = this.els;
    setText(e.bannerTitle, title);
    setText(e.bannerSub, sub);
    e.banner.classList.add('show');
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    if (ms > 0) this.bannerTimer = setTimeout(() => e.banner.classList.remove('show'), ms);
  }

  hideBanner(): void {
    this.els.banner.classList.remove('show');
  }

  subtitle(text: string): void {
    if (!this.settings.accessibility.subtitles) return;
    const el = this.els.subtitle;
    setText(el, text);
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  damageFrom(angle: number): void {
    const el = h('div', { class: 'dmgdir-arc', style: `transform: rotate(${angle}rad)` });
    this.els.dmgDir.appendChild(el);
    setTimeout(() => el.remove(), 900);
    if (!this.settings.accessibility.reduceFlashing) {
      this.els.vignette.classList.remove('hit');
      void this.els.vignette.offsetWidth;
      this.els.vignette.classList.add('hit');
    }
  }

  toggleBigMap(open?: boolean): void {
    this.bigMapOpen = open ?? !this.bigMapOpen;
    toggle(this.els.bigmap, 'show', this.bigMapOpen);
  }

  setScoreboard(rows: { name: string; elims: number; alive: boolean; self: boolean; extra?: string }[]): void {
    clear(this.scoreboard);
    this.scoreboard.append(
      h('div', { class: 'sb-head' }, h('span', {}, 'PLAYER'), h('span', {}, 'ELIMS'), h('span', {}, 'STATUS')),
      ...rows.map((r) => h('div', { class: `sb-row ${r.self ? 'self' : ''} ${r.alive ? '' : 'dead'}` }, h('span', {}, r.name), h('span', {}, String(r.elims)), h('span', {}, r.extra ?? (r.alive ? 'ALIVE' : 'OUT')))),
    );
  }

  // ------------------------------------------------------------ per-frame

  frame(f: HudFrame, camera: PerspectiveCamera, now: number, showPing: boolean): void {
    const e = this.els;
    // Info
    const infoParts: string[] = [];
    if (this.settings.gameplay.showFps) infoParts.push(`${Math.round(f.fps)} FPS`);
    if (showPing) infoParts.push('OFFLINE · BOTS');
    setText(e.info, infoParts.join(' · '));
    toggle(e.training, 'show', f.training);
    if (f.training) {
      setText(e.trainHp, `Health: ${Math.ceil(f.health)}`);
      setText(e.trainSh, `Shield: ${Math.ceil(f.shield)}`);
    }
    // Vitals
    setStyle(e.healthFill, 'width', `${Math.max(0, f.health)}%`);
    setStyle(e.shieldFill, 'width', `${Math.max(0, f.shield)}%`);
    setText(e.healthNum, String(Math.ceil(f.health)));
    setText(e.shieldNum, String(Math.ceil(f.shield)));
    toggle(e.vignette, 'low', f.lowHealth);
    // Counts
    setText(e.aliveNum, String(f.alive));
    setText(e.elimNum, String(f.eliminations));
    setText(e.round, f.roundText);
    toggle(e.round, 'show', !!f.roundText);
    toggle(e.counts, 'hidden', f.training);
    // Storm
    const s = f.storm;
    toggle(e.stormBox, 'show', !!s && f.stormActive);
    if (s && f.stormActive) {
      const label = s.stage === 'done' ? 'FINAL ZONE' : s.stage === 'shrink' ? 'STORM CLOSING' : `STORM PHASE ${s.phase + 1}`;
      setText(e.stormLabel, label);
      setText(e.stormTime, s.stage === 'done' ? '--:--' : formatTime(s.timer));
      toggle(e.stormBox, 'closing', s.stage === 'shrink');
      toggle(e.stormBox, 'outside', !f.stormInside);
    }
    toggle(e.stormVignette, 'show', !!s && !f.stormInside && f.stormActive);
    // Slots
    const key = f.slots.map((s) => (s ? `${s.kind}:${s.kind === 'weapon' ? s.id + s.rarity + s.ammoInMag : s.id + s.count}` : '-')).join('|') + `|${f.selected}|${f.buildPiece}`;
    if (key !== this.lastSlotsKey) {
      this.lastSlotsKey = key;
      this.renderSlots(f);
    }
    // Build bar
    toggle(e.buildBar, 'active', f.buildPiece !== null);
    for (const p of Object.keys(this.pieceEls) as BuildPieceType[]) toggle(this.pieceEls[p], 'selected', f.buildPiece === p);
    for (const m of Object.keys(this.matEls) as BuildMaterial[]) {
      const el = this.matEls[m];
      setText(el.querySelector('.hud-mat-num') as HTMLElement, f.unlimitedMaterials ? '∞' : String(f.materials[m]));
      toggle(el, 'selected', f.buildMaterial === m);
    }
    setText(e.buildHint, f.buildPiece && f.buildInvalidReason ? f.buildInvalidReason.toUpperCase() : '');
    toggle(e.editHint, 'show', f.editing);
    // Ammo
    const cur = f.selected === 'pickaxe' ? null : f.slots[f.selected];
    if (cur && cur.kind === 'weapon' && f.buildPiece === null) {
      toggle(e.ammo, 'show', true);
      setText(e.ammoMag, String(cur.ammoInMag));
      setText(e.ammoRes, f.reserve === Infinity ? '/ ∞' : `/ ${f.reserve ?? 0}`);
      setText(e.ammoName, `${WEAPONS[cur.id].name.toUpperCase()} · ${AMMO_LABEL[WEAPONS[cur.id].ammo].toUpperCase()}`);
      toggle(e.ammo, 'empty', cur.ammoInMag === 0);
    } else toggle(e.ammo, 'show', false);
    // Progress (reload / use item)
    const prog = f.useProgress ?? f.reloadProgress;
    toggle(e.progress, 'show', prog !== null);
    if (prog !== null) {
      setText(e.progressLabel, f.useProgress !== null ? f.useLabel : 'RELOADING');
      setStyle(e.progressFill, 'width', `${Math.round(prog * 100)}%`);
    }
    // Prompt
    setText(e.prompt, f.interactLabel ?? '');
    toggle(e.prompt, 'show', !!f.interactLabel);
    // Crosshair spread
    const spreadPx = this.settings.crosshair.dynamic ? Math.min(40, f.spread * 600) : 0;
    setStyle(e.crosshair, '--ch-spread', `${spreadPx.toFixed(1)}px`);
    toggle(e.crosshair, 'building', f.buildPiece !== null || f.editing);
    toggle(e.scope, 'show', f.scoped);
    toggle(e.crosshair, 'scoped', f.scoped);
    // Deploy / spectate
    setText(e.deploy, f.deployHint);
    toggle(e.deploy, 'show', !!f.deployHint);
    setText(e.spectate, f.spectating ? `SPECTATING ${f.spectating.toUpperCase()} · CLICK TO CYCLE` : '');
    toggle(e.spectate, 'show', !!f.spectating);
    // Minimap (throttled)
    if (this.mapRenderer && now - this.lastMinimap > 0.1) {
      this.lastMinimap = now;
      const ctx = this.minimapCtx;
      const radius = this.mapRenderer.map.half > 120 ? 95 : this.mapRenderer.map.half * 0.9;
      this.mapRenderer.draw(ctx, 190, 190, f.player.x, f.player.z, radius, f.storm, [{ ...f.player, self: true }], { labels: false, circle: false, bus: f.bus });
      setText(e.minimapAlive, f.training ? 'PRACTICE' : `${f.alive} ALIVE`);
      if (this.bigMapOpen) {
        const half = this.mapRenderer.map.half;
        this.mapRenderer.draw(this.bigMapCtx, 620, 620, 0, 0, half, f.storm, [{ ...f.player, self: true }, ...f.others], { labels: true, bus: f.bus });
      }
    }
    // Damage numbers
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    const v = new Vector3();
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      const age = now - d.born;
      if (age > 0.9) {
        d.el.remove();
        this.dmgNums.splice(i, 1);
        continue;
      }
      v.copy(d.pos).setY(d.pos.y + age * d.vy);
      v.project(camera);
      if (v.z > 1) {
        d.el.style.opacity = '0';
        continue;
      }
      d.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hgt}px) translate(-50%, -50%) scale(${age < 0.1 ? 1.3 - age * 3 : 1})`;
      d.el.style.opacity = String(Math.min(1, (0.9 - age) * 3));
    }
  }

  private renderSlots(f: HudFrame): void {
    const e = this.els;
    clear(e.slots);
    const key = (a: keyof KeybindConfig) => codeLabel(this.bindings[a]?.[0]);
    const pick = h('div', { class: `slot slot-pickaxe ${f.selected === 'pickaxe' && f.buildPiece === null ? 'selected' : ''}` }, h('span', { class: 'slot-icon', html: weaponIcon('pickaxe') }), h('span', { class: 'slot-key' }, key('pickaxe')));
    e.slots.appendChild(pick);
    f.slots.forEach((s, i) => {
      const selected = f.selected === i && f.buildPiece === null;
      const rarity = s ? RARITY_INFO[itemRarity(s)] : null;
      const el = h('div', { class: `slot ${selected ? 'selected' : ''} ${s ? '' : 'empty'}`, style: rarity ? `--rarity:${rarity.color}` : '' },
        s ? h('span', { class: 'slot-icon', html: s.kind === 'weapon' ? weaponIcon(s.id) : consumableIcon(s.id) }) : null,
        s && s.kind === 'weapon' ? h('span', { class: 'slot-count' }, String(s.ammoInMag)) : null,
        s && s.kind === 'consumable' ? h('span', { class: 'slot-count' }, `x${s.count}`) : null,
        s ? h('span', { class: 'slot-name' }, s.kind === 'weapon' ? WEAPONS[s.id].short : CONSUMABLES[s.id].name.split(' ')[0].toUpperCase()) : null,
        h('span', { class: 'slot-key' }, key(`slot${i + 1}` as keyof KeybindConfig)),
      );
      e.slots.appendChild(el);
    });
  }

  dispose(): void {
    this.root.remove();
  }
}
