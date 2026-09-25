import { h, clear, $, append } from './dom';
import { ICONS, bannerSvg } from './icons';
import { Overlay } from './overlay';
import type { AppContext, Page } from './context';
import { PlayPage } from './pages/PlayPage';
import { LockerPage } from './pages/LockerPage';
import { ShopPage } from './pages/ShopPage';
import { BattlePassPage } from './pages/BattlePassPage';
import { QuestsPage } from './pages/QuestsPage';
import { CareerPage } from './pages/CareerPage';
import { SettingsPage } from './pages/SettingsPage';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager } from '../save/SaveManager';
import { Progression, xpForLevel } from '../progression/Progression';
import { Input } from '../input/Input';
import { LocalShopService } from '../cosmetics/shop';
import { LobbyScene } from '../rendering/LobbyScene';
import { RenderContext } from '../rendering/RenderContext';
import { GameClient } from '../game/GameClient';
import { MODES } from '../game/modes';
import { cosmetic, type BannerLook, type LoadingLook } from '../cosmetics/catalog';
import { formatNumber, formatTime } from '../core/math';
import { CURRENT_SEASON, BP_XP_PER_TIER } from '../season/season';
import type { BotDifficulty, MatchResult, ModeId } from '../game/matchTypes';
import type { MatchSummary } from '../progression/Progression';
import { logger } from '../core/log';
import { applyPreset, detectPreset } from '../settings/settings';
import { TIPS, NEWS } from './content';

const log = logger('App');

type Tab = 'play' | 'locker' | 'battlepass' | 'shop' | 'quests' | 'career' | 'settings';
type Screen = 'lobby' | 'loading' | 'match' | 'results' | 'onboarding';

/**
 * Top-level application: screen routing, lobby, match lifecycle and the
 * shared render loop. Menus are HTML over the WebGL canvas.
 */
export class App implements AppContext {
  save: SaveManager;
  progression: Progression;
  audio: AudioEngine;
  overlay!: Overlay;
  input!: Input;
  shop: LocalShopService;
  lobby!: LobbyScene;
  render!: RenderContext;
  readonly dev: boolean;
  private screen: Screen = 'loading';
  private tab: Tab = 'play';
  private uiRoot: HTMLElement;
  private hudRoot: HTMLElement;
  private overlayRoot: HTMLElement;
  private lobbyEl!: HTMLElement;
  private header!: HTMLElement;
  private pages!: Record<Tab, Page>;
  private pageHost!: HTMLElement;
  private client: GameClient | null = null;
  private pauseEl: HTMLElement | null = null;
  private lastFrame = performance.now();
  private frameAcc = 0;
  private lastMatch: { mode: ModeId; difficulty: BotDifficulty } | null = null;
  private resultsEl: HTMLElement | null = null;
  private clickToPlay: HTMLElement | null = null;

  constructor(private root: HTMLElement, dev: boolean) {
    this.dev = dev;
    this.save = new SaveManager();
    this.progression = new Progression(this.save);
    this.audio = new AudioEngine(this.save.data.settings.audio);
    this.shop = new LocalShopService(this.save);
    this.uiRoot = $('#ui-root', root);
    this.hudRoot = $('#hud-root', root);
    this.overlayRoot = $('#overlay-root', root);
  }

  /** Boot with a real loading sequence. */
  async boot(): Promise<void> {
    const loading = this.loadingScreen('Starting Robnite');
    const step = async (p: number, label: string, fn: () => void | Promise<void>) => {
      loading.set(p, label);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await fn();
    };
    await step(0.1, 'Loading fonts', async () => {
      try {
        await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);
      } catch {
        /* fonts optional */
      }
    });
    await step(0.3, 'Initialising renderer', () => {
      this.render = new RenderContext($('#canvas-root', this.root), this.save.data.settings.video);
      const v = this.save.data.settings.video;
      if (!this.save.data.profileCreated && !v.autoDetected) {
        // Conservative first-run detection.
        applyPreset(v, detectPreset(this.render.gl));
        v.autoDetected = true;
        this.render.apply(v);
      }
      this.overlay = new Overlay(this.overlayRoot, this.audio);
      this.input = new Input(this.render.canvas, this.save.data.keybinds);
      this.input.onUnlock = () => this.onPointerUnlock();
      this.input.onBlur = () => this.onBlur();
      this.audio.onSubtitle = (t) => this.client?.hud.subtitle(t);
    });
    await step(0.55, 'Building lobby', () => {
      this.lobby = new LobbyScene(this.save.data.settings.video.shadows !== 'off');
      this.refreshCharacter();
      this.render.onResize = () => {
        this.lobby.resize(this.render.aspect);
        this.client?.onResize();
      };
      this.lobby.resize(this.render.aspect);
    });
    await step(0.8, 'Preparing menus', () => {
      this.buildLobby();
      this.applySettings();
    });
    await step(0.95, 'Warming up shaders', () => {
      try {
        this.render.renderer.compile(this.lobby.scene, this.lobby.camera);
      } catch {
        /* ignore */
      }
    });
    loading.set(1, 'Ready');
    requestAnimationFrame((t) => this.loop(t));
    await new Promise((r) => setTimeout(r, 250));
    loading.close();
    // First user gesture unlocks audio (autoplay policy).
    const unlock = () => {
      this.audio.unlock();
      if (this.screen === 'lobby' || this.screen === 'onboarding') this.audio.music('lobby');
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    if (this.save.lastError) void this.overlay.modal({ title: 'SAVE DATA RECOVERED', body: this.save.lastError, buttons: [{ id: 'ok', label: 'OK', kind: 'primary' }] });
    if (!this.save.persistent) this.overlay.toast('STORAGE BLOCKED', 'Progress cannot be saved in this browser session', 'warn', 6000);
    if (!this.save.data.profileCreated) this.onboarding();
    else this.enterLobby(true);
    this.wireProgressionEvents();
  }

  // ------------------------------------------------------------------ loop

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const cap = this.save.data.settings.video.fpsCap;
    const elapsed = now - this.lastFrame;
    // FPS cap via frame skipping (the browser still drives rAF at display rate).
    if (cap > 0 && elapsed < 1000 / cap - 1.5) return;
    this.lastFrame = now;
    const dt = Math.min(0.1, elapsed / 1000);
    if (this.render.contextLost) return;
    try {
      if (this.client && (this.screen === 'match' || this.screen === 'results')) {
        this.client.frame(dt);
      } else {
        this.lobby.frame(dt, this.save.data.settings.accessibility.reducedMotion);
        this.render.renderer.render(this.lobby.scene, this.lobby.camera);
      }
    } catch (e) {
      log.error('frame error', e);
      this.frameAcc++;
      if (this.frameAcc === 1) this.overlay.toast('SOMETHING WENT WRONG', 'An error occurred — see console. Returning to lobby is recommended.', 'warn', 6000);
    }
  }

  // ------------------------------------------------------------------ context API

  applySettings(): void {
    const s = this.save.data.settings;
    this.render?.apply(s.video);
    this.audio.apply(s.audio);
    if (this.input) {
      this.input.bindings = this.save.data.keybinds;
      this.input.rawInput = s.mouse.rawInput;
    }
    this.client?.applySettings();
    const html = document.documentElement;
    html.style.setProperty('--ui-scale', String(s.accessibility.uiScale));
    html.classList.toggle('high-contrast', s.accessibility.highContrast);
    html.classList.toggle('reduced-motion', s.accessibility.reducedMotion);
    html.dataset.colorblind = s.accessibility.colorblind;
  }

  refreshHeader(): void {
    if (!this.header) return;
    const p = this.save.data.profile;
    const need = xpForLevel(p.level);
    const banner = cosmetic(p.equipped.banner)?.look as BannerLook | undefined;
    clear(this.header);
    this.header.append(
      h('div', { class: 'hdr-level' },
        h('div', { class: 'hdr-level-num' }, h('small', {}, 'LEVEL'), String(p.level)),
        h('div', { class: 'hdr-level-bar' }, h('div', { class: 'hdr-level-fill', style: `width:${(p.xp / need) * 100}%` })),
        h('div', { class: 'hdr-level-xp' }, `${formatNumber(p.xp)} / ${formatNumber(need)} XP`),
      ),
      h('button', { class: 'hdr-credits', title: 'Credits (in-game currency, no real money)', onclick: () => this.showTab('shop') }, h('span', { html: ICONS.credits }), formatNumber(p.currency)),
      h('button', { class: 'hdr-profile', onclick: () => this.showProfile() },
        h('span', { class: 'hdr-banner', html: banner ? bannerSvg(banner, 38) : '' }),
        h('span', { class: 'hdr-name' }, p.displayName, h('small', {}, 'LOCAL PROFILE')),
      ),
    );
    const bpClaim = this.progression.claimableCount();
    const bpTab = this.lobbyEl?.querySelector('[data-tab="battlepass"]');
    if (bpTab) bpTab.setAttribute('data-badge', bpClaim ? String(bpClaim) : '');
  }

  refreshCharacter(): void {
    const e = this.save.data.profile.equipped;
    this.lobby?.setLoadout({ outfit: e.outfit, backpack: e.backpack, pickaxe: e.pickaxe, glider: e.glider, wrap: e.wrap, emote: e.emote });
  }

  // ------------------------------------------------------------------ lobby

  private buildLobby(): void {
    const tabs: { id: Tab; label: string }[] = [
      { id: 'play', label: 'PLAY' },
      { id: 'locker', label: 'LOCKER' },
      { id: 'battlepass', label: 'BATTLE PASS' },
      { id: 'shop', label: 'SHOP' },
      { id: 'quests', label: 'QUESTS' },
      { id: 'career', label: 'CAREER' },
      { id: 'settings', label: 'SETTINGS' },
    ];
    this.pages = {
      play: new PlayPage(this),
      locker: new LockerPage(this),
      battlepass: new BattlePassPage(this),
      shop: new ShopPage(this),
      quests: new QuestsPage(this),
      career: new CareerPage(this),
      settings: new SettingsPage(this),
    };
    this.header = h('div', { class: 'hdr-right' });
    this.pageHost = h('div', { class: 'page-host' });
    const nav = h('nav', { class: 'topnav' }, tabs.map((t) => {
      const b = h('button', { class: 'topnav-item', 'data-tab': t.id, onclick: () => this.showTab(t.id) }, t.label);
      b.addEventListener('mouseenter', () => this.audio.ui('hover'));
      return b;
    }));
    const home = h('div', { class: 'lobby-home' },
      h('div', { class: 'home-left' },
        h('div', { class: 'home-season' }, `SEASON ${String(CURRENT_SEASON.number).padStart(2, '0')} · ${CURRENT_SEASON.name}`),
        h('div', { class: 'home-mode' }, this.homeModeLabel()),
      ),
      h('div', { class: 'home-bottom' },
        h('div', { class: 'home-secondary' },
          h('button', { class: 'btn btn-ghost btn-icon', onclick: () => this.showParty() }, h('span', { html: ICONS.party }), 'PARTY'),
          h('button', { class: 'btn btn-ghost btn-icon', onclick: () => this.showNews() }, h('span', { html: ICONS.news }), 'NEWS'),
          h('button', { class: 'btn btn-ghost btn-icon', onclick: () => this.showRedeem() }, h('span', { html: ICONS.code }), 'CODE / REDEEM'),
        ),
        h('button', { class: 'btn btn-play', onclick: () => this.playSelected() }, h('span', { class: 'btn-play-label' }, 'PLAY'), h('span', { class: 'btn-play-mode' }, '')),
      ),
    );
    this.lobbyEl = h('div', { class: 'lobby' },
      h('header', { class: 'lobby-top' },
        h('div', { class: 'brand', onclick: () => this.showTab('play') }, h('span', { class: 'brand-logo', html: ICONS.logo }), h('span', { class: 'brand-name' }, 'ROBNITE')),
        nav,
        this.header,
      ),
      this.pageHost,
      home,
    );
    this.uiRoot.appendChild(this.lobbyEl);
    this.lobbyEl.style.display = 'none';
  }

  private homeModeLabel(): string {
    const m = MODES[(this.pages?.play as PlayPage | undefined)?.selectedMode ?? 'br'];
    return m.name.toUpperCase();
  }

  private playSelected(): void {
    const play = this.pages.play as PlayPage;
    if (this.tab !== 'play') {
      this.showTab('play');
      return;
    }
    play.start();
  }

  showTab(tab: Tab): void {
    this.pages[this.tab]?.hide?.();
    this.tab = tab;
    for (const b of this.lobbyEl.querySelectorAll('.topnav-item')) b.classList.toggle('active', (b as HTMLElement).dataset.tab === tab);
    clear(this.pageHost);
    this.pageHost.appendChild(this.pages[tab].el);
    this.pages[tab].show();
    this.lobbyEl.dataset.tab = tab;
    // Frame the character: centred in the locker, off to the side elsewhere.
    this.lobby.frameOffset = tab === 'locker' ? 0.25 : 1.45;
    const playBtn = this.lobbyEl.querySelector('.btn-play-mode') as HTMLElement | null;
    if (playBtn) playBtn.textContent = MODES[(this.pages.play as PlayPage).selectedMode].name.toUpperCase();
    this.audio.ui('click');
  }

  private enterLobby(first = false): void {
    this.screen = 'lobby';
    this.hudRoot.style.display = 'none';
    this.lobbyEl.style.display = '';
    this.refreshHeader();
    this.refreshCharacter();
    this.showTab(this.tab);
    this.audio.music('lobby');
    this.progression.refreshQuests();
    if (first) {
      const bonus = this.screen === 'lobby' ? this.progression.dailyLogin() : null;
      if (bonus) {
        setTimeout(() => {
          if (this.screen !== 'lobby') {
            this.refreshHeader();
            return;
          }
          void this.overlay.modal({
            title: `DAY ${bonus.streak}`,
            body: h('div', { class: 'daily-body' }, h('div', { class: 'daily-amount', html: `${ICONS.credits}<b>+${bonus.credits}</b>` }), h('p', { class: 'muted' }, `Daily login bonus · ${bonus.streak}-day streak. Come back tomorrow for more.`)),
            buttons: [{ id: 'ok', label: 'COLLECT', kind: 'primary' }],
            className: 'modal-daily',
          }).then(() => {
            this.audio.ui('reward');
            this.refreshHeader();
            this.maybeOfferTutorial();
          });
        }, 400);
      } else this.maybeOfferTutorial();
    }
  }

  private maybeOfferTutorial(): void {
    const t = this.save.data.tutorial;
    if (this.screen !== 'lobby' || t.offered || t.completed || !this.save.data.settings.gameplay.showTutorials) return;
    t.offered = true;
    this.save.save();
    void this.overlay.modal({
      title: 'NEW TO ROBNITE?',
      body: 'Take a quick tutorial covering movement, shooting, building, editing and harvesting. You can replay it any time from Settings.',
      buttons: [{ id: 'skip', label: 'SKIP', kind: 'ghost' }, { id: 'play', label: 'START TUTORIAL', kind: 'primary' }],
    }).then((r) => {
      if (r === 'play') this.startMatch('tutorial', 'normal');
      else {
        t.skipped = true;
        this.save.save();
      }
    });
  }

  // ------------------------------------------------------------------ onboarding

  private onboarding(): void {
    this.screen = 'onboarding';
    this.lobby.frameOffset = 1.2;
    const input = h('input', { type: 'text', class: 'text-input text-input-lg', maxlength: 16, placeholder: 'Display name', 'aria-label': 'Display name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    const err = h('div', { class: 'error-text' });
    const submit = () => {
      const r = this.progression.setDisplayName(input.value);
      if (!r.ok) {
        err.textContent = r.reason ?? 'Invalid name';
        this.audio.ui('error');
        input.focus();
        return;
      }
      this.save.data.profileCreated = true;
      this.save.save();
      this.audio.unlock();
      this.audio.ui('reward');
      el.classList.add('leaving');
      setTimeout(() => {
        el.remove();
        this.enterLobby(true);
      }, 350);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    const el = h('div', { class: 'onboarding' },
      h('div', { class: 'onboarding-card panel-glass' },
        h('div', { class: 'onboarding-logo', html: ICONS.logo }),
        h('h1', { class: 'onboarding-title' }, 'ROBNITE'),
        h('div', { class: 'onboarding-sub' }, 'CREATE PROFILE'),
        h('p', { class: 'muted' }, 'Your profile is stored locally in this browser. No account or server required.'),
        input,
        err,
        h('button', { class: 'btn btn-primary btn-xl', onclick: submit }, 'ENTER ROBNITE'),
        h('div', { class: 'muted small' }, '3–16 characters · letters, numbers, spaces, _ . -'),
      ),
    );
    this.uiRoot.appendChild(el);
    setTimeout(() => input.focus(), 50);
  }

  // ------------------------------------------------------------------ lobby modals

  private async showProfile(): Promise<void> {
    const p = this.save.data.profile;
    const s = this.save.data.stats;
    const fav = this.progression.favoriteMode();
    const outfit = cosmetic(p.equipped.outfit);
    const banner = cosmetic(p.equipped.banner)?.look as BannerLook;
    const nameInput = h('input', { type: 'text', class: 'text-input', maxlength: 16, value: p.displayName }) as HTMLInputElement;
    const err = h('div', { class: 'error-text' });
    const body = h('div', { class: 'profile-body' },
      h('div', { class: 'profile-top' }, h('span', { html: bannerSvg(banner, 72) }), h('div', {}, h('div', { class: 'profile-name' }, p.displayName), h('div', { class: 'muted' }, `Level ${p.level} · ${outfit?.name ?? ''}`), h('div', { class: 'muted small' }, `LOCAL PROFILE · ID ${p.id}`))),
      h('div', { class: 'profile-stats' },
        h('div', {}, h('b', {}, formatNumber(s.wins)), h('small', {}, 'WINS')),
        h('div', {}, h('b', {}, formatNumber(s.eliminations)), h('small', {}, 'ELIMS')),
        h('div', {}, h('b', {}, formatNumber(s.matches)), h('small', {}, 'MATCHES')),
        h('div', {}, h('b', {}, fav ? MODES[fav as ModeId]?.name ?? '—' : '—'), h('small', {}, 'FAVORITE MODE')),
        h('div', {}, h('b', {}, String(p.inventory.length)), h('small', {}, 'COSMETICS')),
      ),
      h('label', { class: 'label' }, 'DISPLAY NAME'),
      h('div', { class: 'row' }, nameInput),
      err,
    );
    const r = await this.overlay.modal({ title: 'PROFILE', body, buttons: [{ id: 'close', label: 'CLOSE', kind: 'ghost' }, { id: 'save', label: 'SAVE NAME', kind: 'primary' }] });
    if (r === 'save') {
      const res = this.progression.setDisplayName(nameInput.value);
      if (res.ok) this.overlay.toast('NAME UPDATED', p.displayName, 'good');
      else this.overlay.toast('INVALID NAME', res.reason ?? '', 'warn');
      this.refreshHeader();
    }
  }

  private showNews(): void {
    const body = h('div', { class: 'news-grid' }, NEWS.map((n) => h('div', { class: 'news-card', style: `--news-art:${n.art}` }, h('div', { class: 'news-art' }), h('div', { class: 'news-title' }, n.title), h('p', { class: 'muted' }, n.body))));
    void this.overlay.modal({ title: "WHAT'S NEW", body, buttons: [{ id: 'ok', label: 'CLOSE', kind: 'primary' }], className: 'modal-wide' });
  }

  private showParty(): void {
    const p = this.save.data.profile;
    const banner = cosmetic(p.equipped.banner)?.look as BannerLook;
    const body = h('div', { class: 'party-body' },
      h('div', { class: 'party-member' }, h('span', { html: bannerSvg(banner, 44) }), h('div', {}, h('b', {}, p.displayName), h('div', { class: 'muted small' }, `Level ${p.level} · Party leader`))),
      h('p', { class: 'muted' }, 'Robnite currently runs fully offline: matches are filled with bots, so parties contain just you. Online parties require the optional multiplayer server described in the README.'),
      h('div', { class: 'party-bots' }, h('span', { html: ICONS.bot }), `Bot difficulty for your matches: ${this.save.data.settings.gameplay.botDifficulty.toUpperCase()} (change it in the PLAY tab).`),
    );
    void this.overlay.modal({ title: 'PARTY', body, buttons: [{ id: 'ok', label: 'CLOSE', kind: 'primary' }] });
  }

  private async showRedeem(): Promise<void> {
    const input = h('input', { type: 'text', class: 'text-input', maxlength: 24, placeholder: 'Enter code', 'aria-label': 'Code' }) as HTMLInputElement;
    const body = h('div', {}, h('p', { class: 'muted' }, 'Redeem a code for cosmetics or Credits. Codes are validated locally.'), input);
    setTimeout(() => input.focus(), 60);
    const r = await this.overlay.modal({ title: 'REDEEM CODE', body, buttons: [{ id: 'cancel', label: 'CANCEL', kind: 'ghost' }, { id: 'redeem', label: 'REDEEM', kind: 'primary' }] });
    if (r !== 'redeem') return;
    const res = this.progression.redeem(input.value);
    this.overlay.toast(res.ok ? 'CODE REDEEMED' : 'CODE NOT ACCEPTED', res.message, res.ok ? 'good' : 'warn');
    if (res.ok) this.audio.ui('reward');
    else this.audio.ui('error');
    this.refreshHeader();
  }

  private wireProgressionEvents(): void {
    const ev = this.progression.events;
    ev.on('LEVEL_UP', (e) => this.overlay.toast('LEVEL UP!', `LEVEL ${e.level}`, 'level', 3500));
    ev.on('BP_TIER', (e) => this.overlay.toast('BATTLE PASS', `Tier ${e.tier} reached — new rewards to claim`, 'good', 3000));
    ev.on('QUEST_COMPLETE', (e) => this.overlay.toast('QUEST COMPLETE', `${e.quest.title} · +${formatNumber(e.quest.rewardXP)} XP`, 'xp', 3000));
  }

  // ------------------------------------------------------------------ match lifecycle

  startMatch(mode: ModeId, difficulty: BotDifficulty): void {
    if (this.screen === 'loading') return;
    void this.runMatch(mode, difficulty);
  }

  private async runMatch(mode: ModeId, difficulty: BotDifficulty): Promise<void> {
    this.audio.unlock();
    this.overlay.clearModals();
    this.closeResults();
    this.lastMatch = { mode, difficulty };
    this.screen = 'loading';
    this.lobbyEl.style.display = 'none';
    this.audio.music('none');
    const m = MODES[mode];
    const look = cosmetic(this.save.data.profile.equipped.loading)?.look as LoadingLook | undefined;
    const loading = this.loadingScreen(m.name, look, m.mapName, mode !== 'tutorial' && m.bots > 0 ? `PREPARING MATCH · ${m.maxPlayers} PLAYERS · BOTS ENABLED` : 'PREPARING SESSION');
    this.client?.dispose();
    this.client = null;
    this.hudRoot.style.display = '';
    clear(this.hudRoot);
    try {
      const client = new GameClient({
        render: this.render,
        audio: this.audio,
        save: this.save,
        progression: this.progression,
        input: this.input,
        overlay: this.overlay,
        hudParent: this.hudRoot,
        dev: this.dev,
        requestPause: () => this.openPause(),
        matchEnded: (r, s) => this.onMatchEnded(r, s),
      }, mode, difficulty);
      await client.load((p, label) => loading.set(p, label));
      this.client = client;
      this.client.onResize();
      loading.close();
      this.screen = 'match';
      this.input.enabled = true;
      this.showClickToPlay();
    } catch (e) {
      log.error('failed to start match', e);
      loading.close();
      this.client?.dispose();
      this.client = null;
      this.hudRoot.style.display = 'none';
      await this.overlay.modal({ title: 'COULD NOT START MATCH', body: `Something went wrong while loading (${e instanceof Error ? e.message : String(e)}). Please try again.`, buttons: [{ id: 'ok', label: 'BACK TO LOBBY', kind: 'primary' }] });
      this.enterLobby();
    }
  }

  /** Pointer lock needs a user gesture: show a click-to-play overlay. */
  private showClickToPlay(): void {
    this.clickToPlay?.remove();
    const el = h('button', { class: 'click-to-play', onclick: () => this.resumeGame() }, h('div', { class: 'ctp-title' }, 'CLICK TO PLAY'), h('div', { class: 'ctp-sub' }, 'Mouse will be captured · ESC to open the menu'));
    this.clickToPlay = el;
    this.overlayRoot.appendChild(el);
  }

  private resumeGame(): void {
    this.clickToPlay?.remove();
    this.clickToPlay = null;
    this.closePause();
    this.client?.setPaused(false);
    this.input.enabled = true;
    void this.input.lock();
    this.render.canvas.focus();
  }

  private onPointerUnlock(): void {
    if (this.screen !== 'match' || !this.client || this.client.isEnded) return;
    if (this.overlay.hasModal) return;
    this.openPause();
  }

  private onBlur(): void {
    // Offline: tabbing out pauses the simulation.
    if (this.screen === 'match' && this.client && !this.client.isEnded && !this.pauseEl) this.openPause();
  }

  private openPause(): void {
    if (!this.client || this.pauseEl || this.screen !== 'match') return;
    this.clickToPlay?.remove();
    this.clickToPlay = null;
    this.client.setPaused(true);
    this.input.unlock();
    this.audio.ui('open');
    const training = this.client.match.mode.training;
    const tutorial = this.client.modeId === 'tutorial';
    const menu = h('div', { class: 'pause-menu' });
    const content = h('div', { class: 'pause-content' });
    const btn = (label: string, fn: () => void, kind = 'btn-ghost') => {
      const b = h('button', { class: `btn ${kind} btn-wide`, onclick: fn }, label);
      b.addEventListener('mouseenter', () => this.audio.ui('hover'));
      return b;
    };
    const showMain = () => {
      clear(content);
      append(content, [
        h('div', { class: 'pause-title' }, 'PAUSED'),
        h('div', { class: 'pause-sub' }, `${this.client!.match.mode.name.toUpperCase()} · OFFLINE — THE MATCH IS PAUSED`),
        btn('RESUME', () => this.resumeGame(), 'btn-primary'),
        training && !tutorial ? btn('RESET BUILDS', () => { this.client!.adapter.sendAction({ type: 'resetBuilds' }); this.resumeGame(); }) : null,
        training && !tutorial ? btn('RESPAWN', () => { this.client!.adapter.sendAction({ type: 'respawn' }); this.resumeGame(); }) : null,
        tutorial ? btn(this.client!.tutorial?.cur === 'done' ? 'FINISH TUTORIAL → BATTLE ROYALE' : 'SKIP STEP', () => {
          if (this.client!.tutorial?.cur === 'done') this.finishTutorial(true);
          else {
            this.client!.tutorial?.skipStep();
            this.resumeGame();
          }
        }) : null,
        tutorial ? btn('SKIP TUTORIAL', () => this.finishTutorial(false)) : null,
        btn('SETTINGS', () => showSettings('general')),
        btn('CONTROLS', () => showSettings('controls')),
        btn('RETURN TO LOBBY', () => void this.leaveMatch(), 'btn-danger'),
      ]);
    };
    const showSettings = (cat: 'general' | 'controls') => {
      clear(content);
      const page = new SettingsPage(this, cat, true);
      content.append(h('button', { class: 'btn btn-ghost back-btn', onclick: () => { page.hide(); showMain(); } }, '← BACK'), page.el);
      page.show(cat);
    };
    menu.appendChild(content);
    this.pauseEl = h('div', { class: 'pause-overlay' }, menu);
    this.overlayRoot.appendChild(this.pauseEl);
    showMain();
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && this.pauseEl && !this.overlay.hasModal && !this.pauseEl.querySelector('.keybind.capturing')) {
        e.preventDefault();
        document.removeEventListener('keydown', onKey);
        this.resumeGame();
      }
    };
    setTimeout(() => document.addEventListener('keydown', onKey), 200);
    this.pauseEl.dataset.keyHandler = '1';
    (this.pauseEl as HTMLElement & { _off?: () => void })._off = () => document.removeEventListener('keydown', onKey);
  }

  private closePause(): void {
    if (!this.pauseEl) return;
    (this.pauseEl as HTMLElement & { _off?: () => void })._off?.();
    this.pauseEl.remove();
    this.pauseEl = null;
  }

  private finishTutorial(toBR: boolean): void {
    this.save.data.tutorial.completed = toBR;
    this.save.data.tutorial.skipped = !toBR;
    this.save.save();
    this.closePause();
    this.exitMatch();
    if (toBR) this.startMatch('br', this.save.data.settings.gameplay.botDifficulty);
    else this.enterLobby();
  }

  private async leaveMatch(): Promise<void> {
    if (!this.client) return;
    const training = this.client.match.mode.training;
    if (!training && !this.client.isEnded) {
      const ok = await this.overlay.confirm('LEAVE MATCH?', 'Leaving now counts as an elimination at your current placement. Progress earned so far is kept.', 'LEAVE', true);
      if (!ok) return;
      const r = this.client.abandon();
      this.closePause();
      if (r) {
        this.showResults(r, this.summaryFallback(r));
        return;
      }
    }
    this.closePause();
    this.exitMatch();
    this.enterLobby();
  }

  private summaryFallback(r: MatchResult): MatchSummary {
    const rec = this.save.data.matchHistory[0];
    const lines = this.progression.matchXP(r);
    return { lines, totalXP: rec?.xp ?? 0, credits: rec?.credits ?? 0, levelBefore: this.save.data.profile.level, levelAfter: this.save.data.profile.level, xpBefore: this.save.data.profile.xp, xpAfter: this.save.data.profile.xp, bpBefore: this.save.data.battlePass.level, bpAfter: this.save.data.battlePass.level, quests: [] };
  }

  private exitMatch(): void {
    this.input.enabled = false;
    this.input.unlock();
    this.clickToPlay?.remove();
    this.clickToPlay = null;
    this.client?.dispose();
    this.client = null;
    clear(this.hudRoot);
    this.hudRoot.style.display = 'none';
  }

  private onMatchEnded(result: MatchResult, summary: MatchSummary | null): void {
    if (!this.client || this.screen !== 'match') return;
    this.input.unlock();
    this.closePause();
    const won = result.won;
    const br = result.mode === 'br';
    const round = this.client.match.isRoundMode;
    const card = h('div', { class: `end-card ${won ? 'won' : 'lost'}` },
      h('div', { class: 'end-title' }, won ? (br ? 'VICTORY' : 'MATCH WON') : 'ELIMINATED'),
      h('div', { class: 'end-place' }, `#${result.placement}`),
      h('div', { class: 'end-sub' }, round ? `${result.roundsWon} rounds won` : `${result.placement} / ${result.totalPlayers}`),
      won && summary ? h('div', { class: 'end-xp' }, `XP EARNED +${formatNumber(summary.totalXP)}`) : null,
      h('div', { class: 'end-stats' }, `${result.eliminations} ELIMS · ${formatNumber(result.damage)} DAMAGE · ${formatTime(result.survivalTime)} SURVIVED`),
      h('div', { class: 'end-actions' },
        !won && br && !this.client.match.decided ? h('button', { class: 'btn btn-ghost', onclick: () => { endEl.remove(); this.spectate(result, summary); } }, 'SPECTATE') : null,
        h('button', { class: 'btn btn-primary', onclick: () => { endEl.remove(); this.showResults(result, summary); } }, won ? 'CONTINUE' : br ? 'RETURN TO LOBBY' : 'CONTINUE'),
      ),
    );
    const endEl = h('div', { class: 'end-overlay' }, card);
    this.overlayRoot.appendChild(endEl);
  }

  private spectate(result: MatchResult, summary: MatchSummary | null): void {
    this.input.enabled = true;
    const bar = h('div', { class: 'spectate-bar' }, h('span', {}, 'SPECTATING'), h('button', { class: 'btn btn-primary btn-sm', onclick: () => { bar.remove(); this.showResults(result, summary); } }, 'CONTINUE TO RESULTS'));
    this.overlayRoot.appendChild(bar);
  }

  private showResults(result: MatchResult, summary: MatchSummary | null): void {
    this.input.enabled = false;
    this.input.unlock();
    this.screen = 'results';
    this.client?.match.markResults();
    if (this.client) this.client.hud.root.style.display = 'none';
    this.closeResults();
    const lines = summary?.lines ?? [];
    const total = summary?.totalXP ?? 0;
    const p = this.save.data.profile;
    const need = xpForLevel(p.level);
    const statBox = (label: string, value: string) => h('div', { class: 'res-stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'res-value' }, value));
    const mode = result.mode;
    const xpList = h('div', { class: 'res-xp-list' });
    const el = h('div', { class: 'results' },
      h('div', { class: 'results-card panel-glass' },
        h('div', { class: 'results-head' }, h('div', { class: 'results-title' }, 'MATCH COMPLETE'), h('div', { class: 'muted' }, `${result.modeName.toUpperCase()} · ${new Date(result.timestamp).toLocaleTimeString()}`)),
        h('div', { class: 'results-grid' },
          statBox('PLACEMENT', `#${result.placement}`),
          statBox('ELIMINATIONS', String(result.eliminations)),
          statBox('DAMAGE', formatNumber(result.damage)),
          statBox('SURVIVAL', formatTime(result.survivalTime)),
          statBox('BUILDS', formatNumber(result.builds)),
          statBox('EDITS', formatNumber(result.edits)),
          statBox('HEADSHOTS', String(result.headshots)),
          statBox('XP', `+${formatNumber(total)}`),
        ),
        h('div', { class: 'results-xp' },
          h('h3', {}, 'XP EARNED'),
          xpList,
          h('div', { class: 'res-level' },
            h('div', { class: 'res-level-label' }, summary && summary.levelAfter > summary.levelBefore ? `LEVEL UP! ${summary.levelBefore} → ${summary.levelAfter}` : `LEVEL ${p.level}`),
            h('div', { class: 'hdr-level-bar big' }, h('div', { class: 'hdr-level-fill', style: `width:${(p.xp / need) * 100}%` })),
            h('div', { class: 'muted small' }, `${formatNumber(p.xp)} / ${formatNumber(need)} XP · Battle Pass tier ${this.save.data.battlePass.level} (${formatNumber(this.save.data.battlePass.xp)} / ${formatNumber(BP_XP_PER_TIER)})`),
          ),
          summary && summary.credits ? h('div', { class: 'res-credits', html: `${ICONS.credits} +${summary.credits} Credits` }) : null,
        ),
        h('div', { class: 'results-actions' },
          h('button', { class: 'btn btn-ghost', onclick: () => { this.closeResults(); this.exitMatch(); this.enterLobby(); } }, 'RETURN TO LOBBY'),
          h('button', { class: 'btn btn-ghost', onclick: () => { this.closeResults(); this.exitMatch(); this.enterLobby(); this.showTab('battlepass'); } }, 'CONTINUE'),
          h('button', { class: 'btn btn-primary', onclick: () => { const lm = this.lastMatch; this.closeResults(); this.exitMatch(); if (lm) this.startMatch(lm.mode, lm.difficulty); } }, mode === 'duel' || mode === 'boxfight' ? 'REMATCH' : 'PLAY AGAIN'),
        ),
      ),
    );
    this.resultsEl = el;
    this.overlayRoot.appendChild(el);
    // Animated XP lines
    lines.forEach((l, i) => {
      setTimeout(() => {
        xpList.appendChild(h('div', { class: 'res-xp-row' }, h('span', {}, l.label), h('b', {}, `+${formatNumber(l.xp)}`)));
        this.audio.ui('tick');
      }, 200 + i * 140);
    });
    if (!lines.length) xpList.appendChild(h('div', { class: 'muted' }, 'Practice modes do not award XP.'));
    this.audio.music('lobby');
  }

  private closeResults(): void {
    this.resultsEl?.remove();
    this.resultsEl = null;
    for (const el of this.overlayRoot.querySelectorAll('.end-overlay, .spectate-bar')) el.remove();
  }

  // ------------------------------------------------------------------ loading screen

  private loadingScreen(title: string, look?: LoadingLook, subtitle = '', status = ''): { set(p: number, label: string): void; close(): void } {
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    const bar = h('div', { class: 'loading-fill' });
    const label = h('div', { class: 'loading-label' });
    const tipEl = h('div', { class: 'loading-tip' }, h('b', {}, 'TIP: '), tip);
    const el = h('div', { class: 'loading', style: look ? `--ld-from:${look.from};--ld-to:${look.to}` : '' },
      h('div', { class: 'loading-art' }),
      h('div', { class: 'loading-center' },
        h('div', { class: 'loading-logo', html: ICONS.logo }),
        h('div', { class: 'loading-brand' }, 'ROBNITE'),
        h('div', { class: 'loading-title' }, title.toUpperCase()),
        subtitle ? h('div', { class: 'loading-subtitle' }, subtitle.toUpperCase()) : null,
        status ? h('div', { class: 'loading-status' }, status) : null,
      ),
      h('div', { class: 'loading-bottom' }, tipEl, h('div', { class: 'loading-bar' }, bar), label),
    );
    this.overlayRoot.appendChild(el);
    let tipTimer = setInterval(() => {
      tipEl.lastChild!.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    }, 4000);
    return {
      set: (p, text) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        label.textContent = `${text.toUpperCase()} · ${Math.round(p * 100)}%`;
      },
      close: () => {
        clearInterval(tipTimer);
        tipTimer = 0 as unknown as ReturnType<typeof setInterval>;
        el.classList.add('hide');
        setTimeout(() => el.remove(), 400);
      },
    };
  }
}
