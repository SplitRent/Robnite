import { ACESFilmicToneMapping, NoToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import type { VideoSettings } from '../settings/settings';
import { logger } from '../core/log';

const log = logger('Renderer');

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Owns the single WebGLRenderer shared by the lobby and matches. */
export class RenderContext {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private scale = 1;
  contextLost = false;
  onResize: (() => void) | null = null;

  constructor(container: HTMLElement, video: VideoSettings) {
    this.renderer = new WebGLRenderer({ antialias: video.antialias, powerPreference: 'high-performance', stencil: false });
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'game-canvas';
    this.canvas.tabIndex = -1;
    container.appendChild(this.canvas);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      log.error('WebGL context lost');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      log.info('WebGL context restored');
    });
    this.apply(video);
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('fullscreenchange', () => this.resize());
    this.resize();
  }

  get gl() {
    return this.renderer.getContext();
  }

  apply(video: VideoSettings): void {
    this.scale = video.renderScale;
    this.renderer.toneMapping = video.postProcessing ? ACESFilmicToneMapping : NoToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = video.shadows !== 'off';
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, true);
    this.onResize?.();
  }

  get aspect(): number {
    return window.innerWidth / Math.max(1, window.innerHeight);
  }

  /** Drawn pixel resolution (for the settings screen). */
  get drawSize(): string {
    return `${this.canvas.width}×${this.canvas.height}`;
  }
}
