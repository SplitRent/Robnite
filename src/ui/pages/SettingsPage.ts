import { h, clear } from '../dom';
import { ACTIONS, DEFAULT_BINDINGS, codeLabel, findConflicts, type ActionId } from '../../input/bindings';
import { applyPreset, detectPreset, type QualityPreset, type Settings } from '../../settings/settings';
import { validateDisplayName } from '../../progression/Progression';
import type { AppContext, Page } from '../context';

type Category = 'general' | 'video' | 'audio' | 'controls' | 'gameplay' | 'hud' | 'accessibility';
const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'general', label: 'GENERAL' },
  { id: 'video', label: 'VIDEO' },
  { id: 'audio', label: 'AUDIO' },
  { id: 'controls', label: 'CONTROLS' },
  { id: 'gameplay', label: 'GAMEPLAY' },
  { id: 'hud', label: 'HUD' },
  { id: 'accessibility', label: 'ACCESSIBILITY' },
];

export class SettingsPage implements Page {
  readonly el: HTMLElement;
  private cat: Category;
  private nav: HTMLElement;
  private body: HTMLElement;
  private capturing: ActionId | null = null;

  constructor(private ctx: AppContext, initial: Category = 'general', private inMatch = false) {
    this.cat = initial;
    this.nav = h('nav', { class: 'settings-nav' });
    this.body = h('div', { class: 'settings-body' });
    this.el = h('section', { class: 'page page-settings' }, h('div', { class: 'page-head' }, h('h1', {}, 'SETTINGS')), h('div', { class: 'settings-layout' }, this.nav, this.body));
  }

  show(cat?: Category): void {
    if (cat) this.cat = cat;
    this.render();
  }

  hide(): void {
    if (this.capturing) this.ctx.input.cancelCapture();
    this.capturing = null;
  }

  private get s(): Settings {
    return this.ctx.save.data.settings;
  }

  private changed(immediate = false): void {
    this.ctx.applySettings();
    if (immediate) this.ctx.save.save();
    else this.ctx.save.saveSoon();
  }

  private render(): void {
    clear(this.nav);
    for (const c of CATEGORIES) {
      this.nav.appendChild(h('button', { class: `settings-nav-item ${c.id === this.cat ? 'active' : ''}`, onclick: () => { this.cat = c.id; this.ctx.audio.ui('click'); this.render(); } }, c.label));
    }
    clear(this.body);
    switch (this.cat) {
      case 'general':
        this.general();
        break;
      case 'video':
        this.video();
        break;
      case 'audio':
        this.audio();
        break;
      case 'controls':
        this.controls();
        break;
      case 'gameplay':
        this.gameplay();
        break;
      case 'hud':
        this.hud();
        break;
      case 'accessibility':
        this.accessibility();
        break;
    }
  }

  // ------------------------------------------------------------ row builders

  private group(title: string): HTMLElement {
    const g = h('div', { class: 'settings-group' }, h('h3', {}, title));
    this.body.appendChild(g);
    return g;
  }

  private slider(parent: HTMLElement, label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, set: (v: number) => void): void {
    const out = h('span', { class: 'setting-value' }, fmt(value));
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      set(v);
      this.changed();
    });
    parent.appendChild(h('div', { class: 'setting-row' }, h('label', {}, label), h('div', { class: 'setting-control' }, input, out)));
  }

  private toggle(parent: HTMLElement, label: string, value: boolean, set: (v: boolean) => void, note = ''): void {
    const btn = h('button', { class: `toggle ${value ? 'on' : ''}`, role: 'switch', 'aria-checked': String(value), 'aria-label': label }, h('span', { class: 'toggle-knob' }), h('span', { class: 'toggle-text' }, value ? 'ON' : 'OFF'));
    btn.addEventListener('click', () => {
      value = !value;
      btn.classList.toggle('on', value);
      btn.setAttribute('aria-checked', String(value));
      (btn.querySelector('.toggle-text') as HTMLElement).textContent = value ? 'ON' : 'OFF';
      this.ctx.audio.ui('click');
      set(value);
      this.changed(true);
    });
    parent.appendChild(h('div', { class: 'setting-row' }, h('label', {}, label, note ? h('small', {}, note) : null), h('div', { class: 'setting-control' }, btn)));
  }

  private select<T extends string | number>(parent: HTMLElement, label: string, value: T, options: { value: T; label: string }[], set: (v: T) => void, note = ''): void {
    const seg = h('div', { class: 'segmented' });
    for (const o of options) {
      seg.appendChild(h('button', { class: `seg ${o.value === value ? 'active' : ''}`, onclick: () => {
        set(o.value);
        this.ctx.audio.ui('click');
        this.changed(true);
        this.render();
      } }, o.label));
    }
    parent.appendChild(h('div', { class: 'setting-row' }, h('label', {}, label, note ? h('small', {}, note) : null), h('div', { class: 'setting-control' }, seg)));
  }

  private button(parent: HTMLElement, label: string, text: string, onClick: () => void, kind: 'ghost' | 'danger' | 'primary' = 'ghost', note = ''): void {
    parent.appendChild(h('div', { class: 'setting-row' }, h('label', {}, label, note ? h('small', {}, note) : null), h('div', { class: 'setting-control' }, h('button', { class: `btn btn-${kind}`, onclick: onClick }, text))));
  }

  // ------------------------------------------------------------ categories

  private general(): void {
    const ctx = this.ctx;
    const g = this.group('PROFILE');
    const nameInput = h('input', { type: 'text', maxlength: 16, value: ctx.save.data.profile.displayName, class: 'text-input', 'aria-label': 'Display name' }) as HTMLInputElement;
    const err = h('small', { class: 'error-text' });
    g.appendChild(h('div', { class: 'setting-row' }, h('label', {}, 'Display name', err), h('div', { class: 'setting-control' }, nameInput, h('button', { class: 'btn btn-primary btn-sm', onclick: () => {
      const r = ctx.progression.setDisplayName(nameInput.value);
      err.textContent = r.ok ? '' : r.reason ?? '';
      if (r.ok) {
        ctx.overlay.toast('NAME UPDATED', ctx.save.data.profile.displayName, 'good');
        ctx.refreshHeader();
      } else ctx.audio.ui('error');
    } }, 'SAVE'))));
    nameInput.addEventListener('input', () => {
      const v = validateDisplayName(nameInput.value);
      err.textContent = v.ok ? '' : v.reason ?? '';
    });
    const d = this.group('DISPLAY');
    this.button(d, 'Fullscreen', document.fullscreenElement ? 'EXIT FULLSCREEN' : 'ENTER FULLSCREEN', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => ctx.overlay.toast('FULLSCREEN UNAVAILABLE', 'Your browser blocked fullscreen', 'warn'));
      setTimeout(() => this.render(), 300);
    });
    this.toggle(d, 'Show tutorials & tips', this.s.gameplay.showTutorials, (v) => (this.s.gameplay.showTutorials = v));
    if (!this.inMatch) this.button(d, 'Tutorial', 'PLAY TUTORIAL', () => ctx.startMatch('tutorial', 'normal'));
    const data = this.group('DATA');
    data.appendChild(h('div', { class: 'setting-row' }, h('label', {}, 'Storage'), h('div', { class: 'setting-control muted' }, ctx.save.persistent ? 'LOCAL PROFILE · saved in this browser' : 'Storage blocked — progress will be lost when the tab closes')));
    if (!this.inMatch) {
      this.button(data, 'Reset local data', 'RESET LOCAL DATA', async () => {
        const a = await ctx.overlay.confirm('RESET LOCAL DATA', 'This will delete local profile and progression, including cosmetics, Credits, stats and settings.', 'CONTINUE', true);
        if (!a) return;
        const b2 = await ctx.overlay.confirm('ARE YOU SURE?', 'This cannot be undone. All local data for Robnite in this browser will be erased.', 'DELETE EVERYTHING', true);
        if (!b2) return;
        ctx.save.reset();
        window.location.reload();
      }, 'danger', 'Requires confirmation twice');
    }
    if (ctx.dev) {
      const dev = this.group('DEVELOPER');
      this.button(dev, 'Grant Credits', '+10,000 CREDITS', () => {
        ctx.progression.addCurrency(10000, 'Developer grant');
        ctx.refreshHeader();
      }, 'primary', 'Dev build only');
      this.button(dev, 'Grant XP', '+10,000 XP', () => {
        ctx.progression.awardXP(10000, 'Developer grant');
        ctx.refreshHeader();
      }, 'ghost', 'Dev build only');
    }
  }

  private video(): void {
    const v = this.s.video;
    const g = this.group('QUALITY');
    this.select<QualityPreset | 'auto' | 'custom'>(g, 'Quality preset', v.preset, [
      { value: 'low', label: 'LOW' },
      { value: 'medium', label: 'MEDIUM' },
      { value: 'high', label: 'HIGH' },
      { value: 'veryhigh', label: 'VERY HIGH' },
      { value: 'auto', label: 'AUTO' },
    ], (p) => {
      if (p === 'auto') {
        applyPreset(v, detectPreset(this.ctx.render.gl));
        v.autoDetected = true;
      } else if (p !== 'custom') {
        applyPreset(v, p);
        v.autoDetected = false;
      }
    }, v.autoDetected ? `Auto-detected: ${v.preset.toUpperCase()}` : v.preset === 'custom' ? 'Custom' : '');
    const custom = () => {
      if (v.preset !== 'custom') v.preset = 'custom';
    };
    this.slider(g, 'Render resolution', v.renderScale, 0.5, 1, 0.05, (x) => `${Math.round(x * 100)}% (${this.ctx.render.drawSize})`, (x) => { v.renderScale = x; custom(); });
    this.select(g, 'Shadows', v.shadows, [{ value: 'off', label: 'OFF' }, { value: 'low', label: 'LOW' }, { value: 'medium', label: 'MED' }, { value: 'high', label: 'HIGH' }], (x) => { v.shadows = x; custom(); }, this.inMatch ? 'Shadow quality applies next match' : '');
    this.select(g, 'Effects', v.effects, [{ value: 'low', label: 'LOW' }, { value: 'medium', label: 'MED' }, { value: 'high', label: 'HIGH' }], (x) => { v.effects = x; custom(); }, 'Applies next match');
    this.select(g, 'Particles', v.particles, [{ value: 'low', label: 'LOW' }, { value: 'medium', label: 'MED' }, { value: 'high', label: 'HIGH' }], (x) => { v.particles = x; custom(); }, 'Applies next match');
    this.slider(g, 'View distance', v.viewDistance, 150, 600, 10, (x) => `${x} m`, (x) => { v.viewDistance = x; custom(); });
    this.toggle(g, 'Post processing', v.postProcessing, (x) => { v.postProcessing = x; custom(); }, 'Filmic tone mapping');
    this.toggle(g, 'Ambient occlusion', v.ambientOcclusion, (x) => { v.ambientOcclusion = x; custom(); }, 'Baked contact shading · applies next match');
    this.toggle(g, 'Anti-aliasing', v.antialias, (x) => { v.antialias = x; }, 'Applies after restarting the game');
    const d = this.group('DISPLAY');
    this.slider(d, 'Field of view', v.fov, 60, 110, 1, (x) => `${x}°`, (x) => (v.fov = x));
    this.select(d, 'FPS limit', v.fpsCap, [30, 60, 90, 120, 144, 0].map((x) => ({ value: x, label: x === 0 ? 'UNLIMITED' : String(x) })), (x) => (v.fpsCap = x), 'The browser may cap to your display refresh rate');
    this.toggle(d, 'Show FPS counter', this.s.gameplay.showFps, (x) => (this.s.gameplay.showFps = x));
  }

  private audio(): void {
    const a = this.s.audio;
    const g = this.group('VOLUME');
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    this.slider(g, 'Master', a.master, 0, 1, 0.01, pct, (x) => (a.master = x));
    this.slider(g, 'Music', a.music, 0, 1, 0.01, pct, (x) => (a.music = x));
    this.slider(g, 'Sound effects', a.sfx, 0, 1, 0.01, pct, (x) => (a.sfx = x));
    this.slider(g, 'Weapons', a.weapons, 0, 1, 0.01, pct, (x) => (a.weapons = x));
    this.slider(g, 'Interface', a.ui, 0, 1, 0.01, pct, (x) => (a.ui = x));
    this.slider(g, 'Ambience', a.ambience, 0, 1, 0.01, pct, (x) => (a.ambience = x));
    this.slider(g, 'Voice (announcer)', a.voice, 0, 1, 0.01, pct, (x) => (a.voice = x));
    this.toggle(g, 'Mute all', a.muteAll, (x) => (a.muteAll = x));
  }

  private controls(): void {
    const m = this.s.mouse;
    const g = this.group('MOUSE');
    const f2 = (x: number) => x.toFixed(2);
    this.slider(g, 'X sensitivity', m.sensX, 0.1, 4, 0.01, f2, (x) => (m.sensX = x));
    this.slider(g, 'Y sensitivity', m.sensY, 0.1, 4, 0.01, f2, (x) => (m.sensY = x));
    this.slider(g, 'ADS sensitivity', m.adsMult, 0.1, 2, 0.01, f2, (x) => (m.adsMult = x));
    this.slider(g, 'Scope sensitivity', m.scopeMult, 0.1, 2, 0.01, f2, (x) => (m.scopeMult = x));
    this.slider(g, 'Building / edit sensitivity', m.buildMult, 0.1, 3, 0.01, f2, (x) => (m.buildMult = x));
    this.toggle(g, 'Invert Y', m.invertY, (x) => (m.invertY = x));
    this.toggle(g, 'Mouse acceleration', m.acceleration, (x) => (m.acceleration = x));
    this.toggle(g, 'Raw input', m.rawInput, (x) => (m.rawInput = x), 'Unadjusted pointer movement where supported');
    const groups = ['Movement', 'Combat', 'Building', 'UI', 'Practice'] as const;
    for (const gr of groups) {
      const kg = this.group(`KEYBINDS · ${gr.toUpperCase()}`);
      for (const a of ACTIONS.filter((x) => x.group === gr)) {
        const codes = this.ctx.save.data.keybinds[a.id] ?? [];
        const btn = h('button', { class: `keybind ${this.capturing === a.id ? 'capturing' : ''}`, onclick: () => this.capture(a.id) }, this.capturing === a.id ? 'PRESS KEY...' : codes.map(codeLabel).join(' / ') || 'UNBOUND');
        kg.appendChild(h('div', { class: 'setting-row' }, h('label', {}, a.label), h('div', { class: 'setting-control' }, btn)));
      }
    }
    const r = this.group('RESET');
    this.button(r, 'Keybinds', 'RESET TO DEFAULTS', async () => {
      if (await this.ctx.overlay.confirm('RESET KEYBINDS', 'Restore all default key bindings?', 'RESET')) {
        this.ctx.save.data.keybinds = structuredClone(DEFAULT_BINDINGS);
        this.changed(true);
        this.render();
      }
    });
    r.appendChild(h('p', { class: 'muted small' }, 'Shared keys are resolved by context: R reloads, rotates while building and resets while editing; E interacts with loot, chests and doors and otherwise edits.'));
  }

  private capture(action: ActionId): void {
    const ctx = this.ctx;
    this.capturing = action;
    this.render();
    ctx.input.captureNext(async (code) => {
      this.capturing = null;
      if (code === 'Escape') {
        this.render();
        return;
      }
      const binds = ctx.save.data.keybinds;
      const conflicts = findConflicts(binds, action, code);
      if (conflicts.length) {
        const names = conflicts.map((c) => ACTIONS.find((a) => a.id === c)?.label ?? c).join(', ');
        const choice = await ctx.overlay.modal({
          title: 'CONFLICT',
          body: `${codeLabel(code)} is already bound to ${names}. Replace it?`,
          buttons: [{ id: 'cancel', label: 'CANCEL', kind: 'ghost' }, { id: 'replace', label: 'REPLACE', kind: 'primary' }],
        });
        if (choice !== 'replace') {
          this.render();
          return;
        }
        for (const c of conflicts) binds[c] = binds[c].filter((x) => x !== code);
      }
      binds[action] = [code, ...(binds[action] ?? []).slice(1).filter((x) => x !== code)];
      ctx.audio.ui('click');
      this.changed(true);
      this.render();
    });
  }

  private gameplay(): void {
    const gp = this.s.gameplay;
    const g = this.group('GAMEPLAY');
    this.toggle(g, 'Auto-pickup ammo & materials', gp.autoPickup, (x) => (gp.autoPickup = x), 'Weapons always require manual pickup');
    this.toggle(g, 'Sprint by default', gp.sprintByDefault, (x) => (gp.sprintByDefault = x), 'Hold sprint to walk');
    this.toggle(g, 'Toggle crouch', gp.toggleCrouch, (x) => (gp.toggleCrouch = x), 'Off = hold to crouch');
    this.toggle(g, 'Damage numbers', gp.damageNumbers, (x) => (gp.damageNumbers = x));
    this.toggle(g, 'Hit markers', gp.hitMarkers, (x) => (gp.hitMarkers = x));
    this.toggle(g, 'Show connection status', gp.showPing, (x) => (gp.showPing = x), 'Offline matches have no ping — shows OFFLINE');
    this.toggle(g, 'Fall damage (training modes)', gp.trainingFallDamage, (x) => (gp.trainingFallDamage = x), 'Freebuild & tutorial · applies next session');
    const e = this.group('BUILDING & EDITING');
    this.toggle(e, 'Edit on release', gp.editOnRelease, (x) => (gp.editOnRelease = x), 'Releasing the selection (or a held edit key) confirms instantly');
    this.toggle(e, 'Hold to edit', gp.holdToEdit, (x) => (gp.holdToEdit = x), 'Releasing the edit key always confirms');
    this.toggle(e, 'Confirm reset on release', gp.confirmResetOnRelease, (x) => (gp.confirmResetOnRelease = x), 'Reset exits edit mode immediately');
    const c = this.group('CAMERA');
    this.slider(c, 'Camera distance', gp.cameraDistance, 2, 5, 0.1, (x) => `${x.toFixed(1)} m`, (x) => (gp.cameraDistance = x));
    this.slider(c, 'Shoulder offset', gp.shoulderOffset, 0, 1.2, 0.05, (x) => `${x.toFixed(2)} m`, (x) => (gp.shoulderOffset = x));
    this.crosshair();
  }

  private crosshair(): void {
    const c = this.s.crosshair;
    const g = this.group('CROSSHAIR');
    const preview = h('div', { class: 'crosshair-preview' }, h('div', { class: 'crosshair static' }, h('i', { class: 'ch-t' }), h('i', { class: 'ch-b' }), h('i', { class: 'ch-l' }), h('i', { class: 'ch-r' }), h('i', { class: 'ch-dot' })));
    const upd = () => {
      const ch = preview.firstElementChild as HTMLElement;
      ch.style.setProperty('--ch-size', `${c.size}px`);
      ch.style.setProperty('--ch-thick', `${c.thickness}px`);
      ch.style.setProperty('--ch-gap', `${c.gap}px`);
      ch.style.setProperty('--ch-color', c.color);
      ch.style.setProperty('--ch-opacity', String(c.opacity));
      ch.classList.toggle('ch-outline', c.outline);
      ch.classList.toggle('ch-nodot', !c.dot);
    };
    g.appendChild(preview);
    const wrap = (fn: (v: number) => void) => (v: number) => {
      fn(v);
      upd();
    };
    this.slider(g, 'Size', c.size, 2, 20, 1, (x) => `${x}px`, wrap((x) => (c.size = x)));
    this.slider(g, 'Thickness', c.thickness, 1, 6, 1, (x) => `${x}px`, wrap((x) => (c.thickness = x)));
    this.slider(g, 'Gap', c.gap, 0, 16, 1, (x) => `${x}px`, wrap((x) => (c.gap = x)));
    this.slider(g, 'Opacity', c.opacity, 0.2, 1, 0.05, (x) => `${Math.round(x * 100)}%`, wrap((x) => (c.opacity = x)));
    this.toggle(g, 'Centre dot', c.dot, (x) => { c.dot = x; upd(); });
    this.toggle(g, 'Outline', c.outline, (x) => { c.outline = x; upd(); });
    this.toggle(g, 'Dynamic spread', c.dynamic, (x) => (c.dynamic = x), 'Crosshair opens with weapon bloom');
    const colors = ['#ffffff', '#5ee7ff', '#3ccf8e', '#ffd23f', '#ff5ad1', '#ff4a4a'];
    const row = h('div', { class: 'swatches' }, colors.map((col) => h('button', { class: `swatch ${c.color === col ? 'active' : ''}`, style: `background:${col}`, 'aria-label': `Crosshair colour ${col}`, onclick: () => { c.color = col; upd(); this.changed(true); this.render(); } })));
    g.appendChild(h('div', { class: 'setting-row' }, h('label', {}, 'Colour'), h('div', { class: 'setting-control' }, row)));
    upd();
  }

  private hud(): void {
    const hu = this.s.hud;
    const g = this.group('HUD ELEMENTS');
    this.toggle(g, 'Minimap', hu.minimap, (x) => (hu.minimap = x));
    this.toggle(g, 'Ammo', hu.ammo, (x) => (hu.ammo = x));
    this.toggle(g, 'Health', hu.health, (x) => (hu.health = x));
    this.toggle(g, 'Shield', hu.shield, (x) => (hu.shield = x));
    this.toggle(g, 'Inventory bar', hu.inventory, (x) => (hu.inventory = x));
    this.toggle(g, 'Storm timer', hu.stormTimer, (x) => (hu.stormTimer = x));
    this.toggle(g, 'Kill feed', hu.killFeed, (x) => (hu.killFeed = x));
    this.toggle(g, 'Crosshair', hu.crosshair, (x) => (hu.crosshair = x));
    this.toggle(g, 'Hit markers', this.s.gameplay.hitMarkers, (x) => (this.s.gameplay.hitMarkers = x));
    this.toggle(g, 'Damage numbers', this.s.gameplay.damageNumbers, (x) => (this.s.gameplay.damageNumbers = x));
    this.toggle(g, 'FPS counter', this.s.gameplay.showFps, (x) => (this.s.gameplay.showFps = x));
    this.toggle(g, 'Connection status', this.s.gameplay.showPing, (x) => (this.s.gameplay.showPing = x));
    this.slider(g, 'HUD scale', hu.scale, 0.7, 1.3, 0.05, (x) => `${Math.round(x * 100)}%`, (x) => (hu.scale = x));
  }

  private accessibility(): void {
    const a = this.s.accessibility;
    const g = this.group('ACCESSIBILITY');
    this.select(g, 'Colour-blind mode', a.colorblind, [
      { value: 'off', label: 'OFF' },
      { value: 'protanopia', label: 'PROTANOPIA' },
      { value: 'deuteranopia', label: 'DEUTERANOPIA' },
      { value: 'tritanopia', label: 'TRITANOPIA' },
    ], (x) => (a.colorblind = x), 'Adjusts rarity, health and team colours');
    this.toggle(g, 'Reduced motion', a.reducedMotion, (x) => (a.reducedMotion = x), 'Less camera and menu motion');
    this.toggle(g, 'Screen shake', a.screenShake, (x) => (a.screenShake = x));
    this.toggle(g, 'Subtitles', a.subtitles, (x) => (a.subtitles = x), 'Shows announcer lines');
    this.toggle(g, 'High contrast UI', a.highContrast, (x) => (a.highContrast = x));
    this.toggle(g, 'Reduce flashing effects', a.reduceFlashing, (x) => (a.reduceFlashing = x));
    this.slider(g, 'UI scale', a.uiScale, 0.8, 1.3, 0.05, (x) => `${Math.round(x * 100)}%`, (x) => (a.uiScale = x));
  }
}
