import type { AudioEngine } from '../audio/AudioEngine';
import type { SaveManager } from '../save/SaveManager';
import type { Progression } from '../progression/Progression';
import type { Overlay } from './overlay';
import type { Input } from '../input/Input';
import type { ShopService } from '../cosmetics/shop';
import type { LobbyScene } from '../rendering/LobbyScene';
import type { RenderContext } from '../rendering/RenderContext';
import type { ModeId, BotDifficulty } from '../game/matchTypes';

/** Services shared by all UI screens. */
export interface AppContext {
  save: SaveManager;
  progression: Progression;
  audio: AudioEngine;
  overlay: Overlay;
  input: Input;
  shop: ShopService;
  lobby: LobbyScene;
  render: RenderContext;
  dev: boolean;
  /** Re-apply settings everywhere (renderer, audio, HUD, input). */
  applySettings(): void;
  /** Refresh the lobby header (level / credits / name). */
  refreshHeader(): void;
  startMatch(mode: ModeId, difficulty: BotDifficulty): void;
  /** Update the 3D lobby character from equipped cosmetics. */
  refreshCharacter(): void;
}

/** A lobby page (tab). */
export interface Page {
  readonly el: HTMLElement;
  show(): void;
  hide?(): void;
}

export function uiSound<T extends HTMLElement>(ctx: AppContext, el: T): T {
  el.addEventListener('mouseenter', () => ctx.audio.ui('hover'));
  el.addEventListener('click', () => ctx.audio.ui('click'));
  return el;
}
