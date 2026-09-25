import type { AudioSettings } from '../settings/settings';
import { logger } from '../core/log';

const log = logger('Audio');

export type Bus = 'music' | 'sfx' | 'weapons' | 'ui' | 'ambience' | 'voice';
export type UISound = 'hover' | 'click' | 'open' | 'close' | 'purchase' | 'reward' | 'levelup' | 'error' | 'toast' | 'tick';

interface Pos {
  x: number;
  y: number;
  z: number;
}

/**
 * Fully procedural audio (Web Audio API): every sound is synthesised at
 * runtime, so there are no audio assets to load or license.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private noise: AudioBuffer | null = null;
  private listener = { x: 0, y: 0, z: 0, yaw: 0 };
  private settings: AudioSettings;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private musicMode: 'none' | 'lobby' | 'match' = 'none';
  private musicStep = 0;
  private nextNoteTime = 0;
  private ambience: { wind: GainNode; hum: GainNode; storm: GainNode; water: GainNode } | null = null;
  private lastBird = 0;
  onSubtitle: ((text: string) => void) | null = null;
  private recent = new Map<string, number>();

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  /** Must be called from a user gesture (autoplay policies). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          log.warn('Web Audio is not supported — the game will be silent');
          return;
        }
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        for (const b of ['music', 'sfx', 'weapons', 'ui', 'ambience', 'voice'] as Bus[]) {
          const g = this.ctx.createGain();
          g.connect(this.master);
          this.buses[b] = g;
        }
        this.noise = this.makeNoise();
        this.apply(this.settings);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) {
      log.error('failed to initialise audio', e);
      this.ctx = null;
    }
  }

  apply(s: AudioSettings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muteAll ? 0 : s.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.music * 0.5, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.weapons.gain.setTargetAtTime(s.weapons * 0.8, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(s.ui * 0.6, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(s.ambience * 0.6, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(s.voice, t, 0.05);
  }

  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listener.x = x;
    this.listener.y = y;
    this.listener.z = z;
    this.listener.yaw = yaw;
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Distance attenuation + stereo pan relative to the listener. */
  private spatial(pos: Pos | undefined, maxDist: number): { gain: number; pan: number } {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x;
    const dz = pos.z - this.listener.z;
    const dy = pos.y - this.listener.y;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDist) return { gain: 0, pan: 0 };
    const gain = 1 / (1 + (d / 8) ** 1.4);
    // Right vector for yaw (yaw 0 looks toward -Z).
    const rx = Math.cos(this.listener.yaw);
    const rz = -Math.sin(this.listener.yaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0;
    return { gain, pan };
  }

  private out(bus: Bus, pos: Pos | undefined, maxDist: number, volume: number): AudioNode | null {
    if (!this.ctx) return null;
    const { gain, pan } = this.spatial(pos, maxDist);
    if (gain * volume < 0.005) return null;
    const g = this.ctx.createGain();
    g.gain.value = gain * volume;
    if (pos && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan * 0.8;
      g.connect(p).connect(this.buses[bus]);
    } else g.connect(this.buses[bus]);
    return g;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, filterType: BiquadFilterType, freq: number, q = 1, attack = 0.002, vol = 1, freqEnd?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.5, freqEnd?: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Rate-limit identical sounds (e.g. many pellets hitting at once). */
  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const last = this.recent.get(key) ?? 0;
    if (now - last < ms) return false;
    this.recent.set(key, now);
    return true;
  }

  ui(name: UISound): void {
    if (!this.ctx) return;
    const d = this.out('ui', undefined, 0, 1);
    if (!d) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'hover':
        if (!this.throttle('hover', 40)) return;
        this.tone(d, t, 1400, 0.04, 'sine', 0.06);
        break;
      case 'click':
        this.tone(d, t, 900, 0.06, 'triangle', 0.18, 600);
        break;
      case 'tick':
        this.tone(d, t, 2000, 0.03, 'square', 0.04);
        break;
      case 'open':
        this.tone(d, t, 500, 0.12, 'sine', 0.15, 900);
        break;
      case 'close':
        this.tone(d, t, 800, 0.1, 'sine', 0.12, 450);
        break;
      case 'error':
        this.tone(d, t, 220, 0.15, 'square', 0.08);
        this.tone(d, t + 0.1, 180, 0.2, 'square', 0.08);
        break;
      case 'toast':
        this.tone(d, t, 1320, 0.12, 'sine', 0.1);
        break;
      case 'purchase':
        [660, 880, 1320].forEach((f, i) => this.tone(d, t + i * 0.07, f, 0.25, 'triangle', 0.18));
        break;
      case 'reward':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.06, f, 0.35, 'triangle', 0.16));
        break;
      case 'levelup':
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.08, f, 0.5, 'sawtooth', 0.07));
        [523, 1046].forEach((f) => this.tone(d, t + 0.4, f, 0.9, 'sine', 0.15));
        break;
    }
  }

  weapon(id: string, pos?: Pos, silencedDistance = 180): void {
    if (!this.ctx) return;
    const d = this.out('weapons', pos, silencedDistance, 1);
    if (!d) return;
    const t = this.ctx.currentTime;
    switch (id) {
      case 'ar':
        this.noiseBurst(d, t, 0.14, 'bandpass', 1400, 0.8, 0.001, 0.9, 400);
        this.tone(d, t, 140, 0.1, 'sine', 0.6, 60);
        break;
      case 'smg':
        this.noiseBurst(d, t, 0.08, 'bandpass', 2200, 1, 0.001, 0.6, 900);
        this.tone(d, t, 180, 0.06, 'square', 0.18, 90);
        break;
      case 'shotgun':
        this.noiseBurst(d, t, 0.35, 'lowpass', 2600, 0.7, 0.001, 1.2, 250);
        this.tone(d, t, 90, 0.3, 'sine', 0.9, 40);
        this.noiseBurst(d, t + 0.45, 0.06, 'highpass', 3000, 1, 0.001, 0.25);
        this.noiseBurst(d, t + 0.6, 0.06, 'highpass', 2500, 1, 0.001, 0.25);
        break;
      case 'marksman':
        this.noiseBurst(d, t, 0.6, 'bandpass', 1800, 0.5, 0.001, 1.1, 200);
        this.tone(d, t, 120, 0.45, 'sine', 0.8, 45);
        break;
      case 'pickaxe':
        this.noiseBurst(d, t, 0.18, 'bandpass', 700, 0.6, 0.02, 0.25, 1600);
        break;
    }
  }

  sfx(name: string, pos?: Pos, volume = 1, variant = ''): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const d = this.out('sfx', pos, name === 'footstep' ? 30 : 90, volume);
    if (!d) return;
    switch (name) {
      case 'footstep':
        this.noiseBurst(d, t, 0.07, 'lowpass', variant === 'build' ? 900 : 500, 1, 0.002, 0.35);
        break;
      case 'jump':
        this.noiseBurst(d, t, 0.18, 'bandpass', 500, 1, 0.01, 0.2, 1500);
        break;
      case 'land':
        this.tone(d, t, 110, 0.15, 'sine', 0.5, 50);
        this.noiseBurst(d, t, 0.12, 'lowpass', 400, 1, 0.002, 0.4);
        break;
      case 'reload':
        this.noiseBurst(d, t, 0.05, 'highpass', 2500, 2, 0.001, 0.3);
        this.noiseBurst(d, t + 0.25, 0.06, 'highpass', 1800, 2, 0.001, 0.35);
        break;
      case 'reloadEnd':
        this.noiseBurst(d, t, 0.07, 'bandpass', 1500, 3, 0.001, 0.4);
        break;
      case 'switch':
        this.noiseBurst(d, t, 0.05, 'bandpass', 2400, 3, 0.001, 0.25);
        break;
      case 'build': {
        const f = variant === 'metal' ? 900 : variant === 'stone' ? 260 : 420;
        this.tone(d, t, f, 0.12, variant === 'metal' ? 'square' : 'triangle', 0.25, f * 0.7);
        this.noiseBurst(d, t, 0.1, 'bandpass', f * 2, 1.5, 0.001, 0.35);
        break;
      }
      case 'edit':
        this.tone(d, t, 1200, 0.05, 'triangle', 0.18, 1600);
        break;
      case 'editReset':
        this.tone(d, t, 1600, 0.06, 'triangle', 0.16, 900);
        break;
      case 'buildHit':
        if (!this.throttle(`bh${variant}`, 30)) return;
        this.noiseBurst(d, t, 0.08, 'bandpass', variant === 'metal' ? 2600 : variant === 'stone' ? 900 : 1300, 2, 0.001, 0.35);
        break;
      case 'buildBreak':
        this.noiseBurst(d, t, 0.45, 'lowpass', 1800, 0.8, 0.001, 0.9, 200);
        this.tone(d, t, 80, 0.3, 'sine', 0.5, 40);
        break;
      case 'harvest': {
        const f = variant === 'metal' ? 2200 : variant === 'stone' ? 1100 : 600;
        this.noiseBurst(d, t, 0.12, 'bandpass', f, 2.5, 0.001, 0.7);
        this.tone(d, t, f / 3, 0.08, 'triangle', 0.3);
        break;
      }
      case 'pickup':
        this.tone(d, t, 880, 0.1, 'sine', 0.25);
        this.tone(d, t + 0.06, 1320, 0.15, 'sine', 0.2);
        break;
      case 'chest':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(d, t + i * 0.05, f, 0.4, 'triangle', 0.14));
        this.noiseBurst(d, t, 0.3, 'highpass', 4000, 1, 0.01, 0.15);
        break;
      case 'door':
        this.noiseBurst(d, t, 0.25, 'bandpass', 300, 3, 0.02, 0.3, 500);
        break;
      case 'impact':
        if (!this.throttle('impact', 25)) return;
        this.noiseBurst(d, t, 0.05, 'bandpass', 2000, 2, 0.001, 0.2);
        break;
      case 'glider':
        this.noiseBurst(d, t, 0.5, 'bandpass', 300, 0.8, 0.05, 0.4, 900);
        break;
      case 'heal':
        [660, 880, 1100].forEach((f, i) => this.tone(d, t + i * 0.08, f, 0.3, 'sine', 0.12));
        break;
      case 'hurt':
        this.tone(d, t, 160, 0.18, 'sawtooth', 0.12, 80);
        this.noiseBurst(d, t, 0.1, 'lowpass', 700, 1, 0.002, 0.4);
        break;
      case 'shieldHit':
        this.tone(d, t, 1600, 0.08, 'sine', 0.15, 2400);
        break;
      case 'shieldBreak':
        this.noiseBurst(d, t, 0.3, 'highpass', 3000, 1, 0.002, 0.4);
        this.tone(d, t, 1200, 0.3, 'triangle', 0.18, 300);
        break;
      case 'eliminated':
        this.tone(d, t, 300, 0.6, 'sawtooth', 0.12, 80);
        break;
      case 'bus':
        this.noiseBurst(d, t, 1.5, 'lowpass', 300, 1, 0.3, 0.2);
        break;
    }
  }

  hitmarker(headshot: boolean, kill: boolean): void {
    if (!this.ctx) return;
    const d = this.out('sfx', undefined, 0, 1);
    if (!d) return;
    const t = this.ctx.currentTime;
    if (!this.throttle('hit', 30)) return;
    if (kill) {
      this.tone(d, t, 880, 0.12, 'triangle', 0.3);
      this.tone(d, t + 0.1, 1320, 0.3, 'triangle', 0.3);
    } else if (headshot) this.tone(d, t, 1760, 0.09, 'triangle', 0.25);
    else this.tone(d, t, 1100, 0.05, 'triangle', 0.18);
  }

  stinger(kind: 'victory' | 'defeat' | 'storm' | 'round'): void {
    if (!this.ctx) return;
    const d = this.out('music', undefined, 0, 1.6);
    if (!d) return;
    const t = this.ctx.currentTime;
    if (kind === 'victory') {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(d, t + i * 0.12, f, 1.2, 'sawtooth', 0.08));
      [261, 392, 523].forEach((f) => this.tone(d, t + 0.5, f, 2.2, 'triangle', 0.15));
    } else if (kind === 'defeat') {
      [392, 349, 311, 262].forEach((f, i) => this.tone(d, t + i * 0.22, f, 0.8, 'triangle', 0.14));
    } else if (kind === 'round') {
      [659, 988].forEach((f, i) => this.tone(d, t + i * 0.1, f, 0.4, 'triangle', 0.14));
    } else {
      for (let i = 0; i < 3; i++) this.tone(d, t + i * 0.25, 740, 0.15, 'square', 0.07);
    }
  }

  /** Announcer line via speech synthesis on the voice bus volume (+ subtitle). */
  announce(text: string): void {
    this.onSubtitle?.(text);
    const s = this.settings;
    if (s.muteAll || s.voice * s.master < 0.02) return;
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.volume = Math.min(1, s.voice * s.master);
      u.rate = 1.05;
      u.pitch = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech unavailable */
    }
  }

  // ---------------------------------------------------------------- music

  music(mode: 'none' | 'lobby' | 'match'): void {
    if (this.musicMode === mode) return;
    this.musicMode = mode;
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (mode === 'none' || !this.ctx) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicStep = 0;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 100);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.musicMode === 'none') return;
    const d = this.buses.music;
    const lobby = this.musicMode === 'lobby';
    const beat = lobby ? 0.3 : 0.42;
    // i–VI–III–VII progression in A minor (original procedural loop).
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    while (this.nextNoteTime < ctx.currentTime + 0.4) {
      const step = this.musicStep;
      const chord = chords[Math.floor(step / 16) % chords.length];
      const t = this.nextNoteTime;
      const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
      if (step % 16 === 0) for (const n of chord) this.tone(d, t, hz(n), beat * 16, 'triangle', lobby ? 0.05 : 0.025, undefined, 0.6);
      if (lobby) {
        if (step % 2 === 0) {
          const n = chord[(step / 2) % 3] + 12 + (step % 8 === 6 ? 12 : 0);
          this.tone(d, t, hz(n), beat * 1.6, 'sine', 0.05);
        }
        if (step % 4 === 0) this.tone(d, t, hz(chord[0] - 12), beat * 0.9, 'sine', 0.12, hz(chord[0] - 12) * 0.98);
        if (step % 8 === 4) this.noiseBurst(d, t, 0.08, 'highpass', 6000, 1, 0.001, 0.04);
      } else if (step % 4 === 0) {
        this.tone(d, t, hz(chord[0] - 24), beat * 3, 'sine', 0.06);
      }
      this.nextNoteTime += beat;
      this.musicStep++;
    }
  }

  // ---------------------------------------------------------------- ambience

  startAmbience(): void {
    if (!this.ctx || this.ambience || !this.noise) return;
    const ctx = this.ctx;
    const mkNoise = (type: BiquadFilterType, freq: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.buses.ambience);
      src.start();
      return g;
    };
    const hum = ctx.createGain();
    hum.gain.value = 0;
    const o = ctx.createOscillator();
    o.frequency.value = 55;
    o.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 200;
    o.connect(lp).connect(hum).connect(this.buses.ambience);
    o.start();
    this.ambience = { wind: mkNoise('lowpass', 500), hum, storm: mkNoise('lowpass', 180), water: mkNoise('bandpass', 1200) };
  }

  /** Update ambience mix: 0..1 levels for each layer. */
  updateAmbience(levels: { wind: number; hum: number; storm: number; water: number; birds: boolean }): void {
    if (!this.ctx || !this.ambience) return;
    const t = this.ctx.currentTime;
    this.ambience.wind.gain.setTargetAtTime(levels.wind * 0.25, t, 0.5);
    this.ambience.hum.gain.setTargetAtTime(levels.hum * 0.08, t, 0.5);
    this.ambience.storm.gain.setTargetAtTime(levels.storm * 0.6, t, 0.3);
    this.ambience.water.gain.setTargetAtTime(levels.water * 0.06, t, 0.5);
    if (levels.birds && performance.now() - this.lastBird > 2500 + Math.random() * 4000) {
      this.lastBird = performance.now();
      const d = this.buses.ambience;
      const f = 2200 + Math.random() * 1600;
      for (let i = 0; i < 3; i++) this.tone(d, t + i * 0.12, f + i * 150, 0.08, 'sine', 0.03, f * 1.2);
    }
  }

  stopAmbience(): void {
    if (!this.ctx || !this.ambience) return;
    const t = this.ctx.currentTime;
    for (const g of Object.values(this.ambience)) g.gain.setTargetAtTime(0, t, 0.2);
  }
}
