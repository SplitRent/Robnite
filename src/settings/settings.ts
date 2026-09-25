import type { BotDifficulty } from '../game/matchTypes';

export type QualityPreset = 'low' | 'medium' | 'high' | 'veryhigh';

export interface VideoSettings {
  preset: QualityPreset | 'custom';
  autoDetected: boolean;
  renderScale: number;
  shadows: 'off' | 'low' | 'medium' | 'high';
  effects: 'low' | 'medium' | 'high';
  particles: 'low' | 'medium' | 'high';
  postProcessing: boolean;
  viewDistance: number;
  antialias: boolean;
  ambientOcclusion: boolean;
  fov: number;
  fpsCap: number;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  weapons: number;
  ui: number;
  ambience: number;
  voice: number;
  muteAll: boolean;
}

export interface MouseSettings {
  sensX: number;
  sensY: number;
  adsMult: number;
  scopeMult: number;
  buildMult: number;
  invertY: boolean;
  acceleration: boolean;
  rawInput: boolean;
}

export interface CrosshairSettings {
  size: number;
  thickness: number;
  gap: number;
  opacity: number;
  dot: boolean;
  outline: boolean;
  color: string;
  dynamic: boolean;
}

export interface GameplaySettings {
  autoPickup: boolean;
  holdToEdit: boolean;
  editOnRelease: boolean;
  confirmResetOnRelease: boolean;
  sprintByDefault: boolean;
  toggleCrouch: boolean;
  damageNumbers: boolean;
  hitMarkers: boolean;
  showFps: boolean;
  showPing: boolean;
  showTutorials: boolean;
  trainingFallDamage: boolean;
  botDifficulty: BotDifficulty;
  cameraDistance: number;
  shoulderOffset: number;
}

export interface HudSettings {
  minimap: boolean;
  ammo: boolean;
  health: boolean;
  shield: boolean;
  inventory: boolean;
  stormTimer: boolean;
  killFeed: boolean;
  crosshair: boolean;
  scale: number;
}

export interface AccessibilitySettings {
  colorblind: 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  reducedMotion: boolean;
  screenShake: boolean;
  subtitles: boolean;
  uiScale: number;
  highContrast: boolean;
  reduceFlashing: boolean;
}

export interface Settings {
  video: VideoSettings;
  audio: AudioSettings;
  mouse: MouseSettings;
  crosshair: CrosshairSettings;
  gameplay: GameplaySettings;
  hud: HudSettings;
  accessibility: AccessibilitySettings;
}

export const PRESETS: Record<QualityPreset, Omit<VideoSettings, 'preset' | 'autoDetected' | 'fov' | 'fpsCap' | 'antialias'>> = {
  low: { renderScale: 0.7, shadows: 'off', effects: 'low', particles: 'low', postProcessing: false, viewDistance: 220, ambientOcclusion: false },
  medium: { renderScale: 0.85, shadows: 'low', effects: 'medium', particles: 'medium', postProcessing: true, viewDistance: 320, ambientOcclusion: true },
  high: { renderScale: 1, shadows: 'medium', effects: 'high', particles: 'high', postProcessing: true, viewDistance: 450, ambientOcclusion: true },
  veryhigh: { renderScale: 1, shadows: 'high', effects: 'high', particles: 'high', postProcessing: true, viewDistance: 600, ambientOcclusion: true },
};

export function defaultSettings(): Settings {
  return {
    video: { preset: 'medium', autoDetected: false, ...PRESETS.medium, antialias: true, fov: 80, fpsCap: 60 },
    audio: { master: 0.8, music: 0.5, sfx: 0.8, weapons: 0.8, ui: 0.7, ambience: 0.6, voice: 0.7, muteAll: false },
    mouse: { sensX: 1, sensY: 1, adsMult: 0.7, scopeMult: 0.5, buildMult: 1, invertY: false, acceleration: false, rawInput: true },
    crosshair: { size: 7, thickness: 2, gap: 4, opacity: 0.95, dot: true, outline: true, color: '#ffffff', dynamic: true },
    gameplay: {
      autoPickup: true,
      holdToEdit: false,
      editOnRelease: true,
      confirmResetOnRelease: true,
      sprintByDefault: false,
      toggleCrouch: false,
      damageNumbers: true,
      hitMarkers: true,
      showFps: false,
      showPing: false,
      showTutorials: true,
      trainingFallDamage: false,
      botDifficulty: 'normal',
      cameraDistance: 4.3,
      shoulderOffset: 0.75,
    },
    hud: { minimap: true, ammo: true, health: true, shield: true, inventory: true, stormTimer: true, killFeed: true, crosshair: true, scale: 1 },
    accessibility: { colorblind: 'off', reducedMotion: false, screenShake: true, subtitles: false, uiScale: 1, highContrast: false, reduceFlashing: false },
  };
}

export function applyPreset(v: VideoSettings, preset: QualityPreset): void {
  Object.assign(v, PRESETS[preset]);
  v.preset = preset;
}

/** Conservative hardware guess for the "Auto" preset. */
export function detectPreset(gl: WebGLRenderingContext | WebGL2RenderingContext | null): QualityPreset {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = navigator.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 4;
  let gpu = '';
  try {
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).toLowerCase();
  } catch {
    /* renderer info unavailable */
  }
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return 'low';
  const discrete = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|arc a/.test(gpu) && !/intel/.test(gpu);
  if (cores <= 2 || mem <= 2) return 'low';
  if (discrete && cores >= 8 && mem >= 8) return 'high';
  return 'medium';
}
