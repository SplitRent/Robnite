import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { Rng } from '../core/rng';
import type { BuildMaterial } from '../building/grid';

/** Procedural canvas textures — no external image assets required. */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[Robnite][Textures] 2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.anisotropy = 4;
  return t;
}

const cache = new Map<string, Texture>();
function cached(key: string, make: () => Texture): Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

/** Subtle grey noise used to break up flat vertex colours (multiplied). */
export function detailTexture(): Texture {
  return cached('detail', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng('detail');
    const img = ctx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 200 + rng.next() * 55;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Soft blotches
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${rng.next() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`;
      ctx.beginPath();
      ctx.arc(rng.next() * 256, rng.next() * 256, 8 + rng.next() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

export function buildTexture(mat: BuildMaterial): Texture {
  return cached(`build-${mat}`, () => {
    const [c, ctx] = canvas(128, 128);
    const rng = new Rng(`build-${mat}`);
    if (mat === 'wood') {
      ctx.fillStyle = '#c08a55';
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 4; i++) {
        const y = i * 32;
        ctx.fillStyle = i % 2 ? '#b57f4b' : '#c99462';
        ctx.fillRect(0, y + 1, 128, 30);
        ctx.fillStyle = 'rgba(80,45,20,0.55)';
        ctx.fillRect(0, y, 128, 2);
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = 'rgba(90,50,20,0.18)';
          ctx.fillRect(0, y + 4 + rng.next() * 24, 128, 1);
        }
        ctx.fillStyle = 'rgba(60,35,15,0.6)';
        ctx.beginPath();
        ctx.arc(10 + rng.next() * 108, y + 16, 1.5, 0, 7);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(70,40,15,0.7)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 124, 124);
    } else if (mat === 'stone') {
      ctx.fillStyle = '#8f949a';
      ctx.fillRect(0, 0, 128, 128);
      for (let row = 0; row < 5; row++) {
        const h = 128 / 5;
        const off = row % 2 ? 21 : 0;
        for (let col = -1; col < 4; col++) {
          const x = col * 42 + off;
          const shade = 125 + rng.next() * 40;
          ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 8})`;
          ctx.fillRect(x + 2, row * h + 2, 38, h - 4);
        }
      }
      ctx.strokeStyle = 'rgba(40,44,50,0.6)';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 124, 124);
    } else {
      ctx.fillStyle = '#7d8ea0';
      ctx.fillRect(0, 0, 128, 128);
      const g = ctx.createLinearGradient(0, 0, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(0,0,0,0.15)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = 'rgba(30,40,55,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(3, 3, 122, 122);
      ctx.beginPath();
      ctx.moveTo(64, 3);
      ctx.lineTo(64, 125);
      ctx.moveTo(3, 64);
      ctx.lineTo(125, 64);
      ctx.stroke();
      ctx.fillStyle = 'rgba(210,220,230,0.9)';
      for (const [x, y] of [[10, 10], [118, 10], [10, 118], [118, 118], [56, 10], [72, 118], [10, 56], [118, 72]]) {
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 7);
        ctx.fill();
      }
    }
    return finish(c);
  });
}

/** Text sign texture. */
export function signTexture(text: string, color = '#ffffff', bg = 'rgba(15,20,28,0.0)'): Texture {
  return cached(`sign-${text}-${color}-${bg}`, () => {
    const [c, ctx] = canvas(512, 96);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 64;
    ctx.font = `800 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
    while (ctx.measureText(text).width > 480 && size > 18) {
      size -= 4;
      ctx.font = `800 ${size}px Inter, "Segoe UI", system-ui, sans-serif`;
    }
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.fillText(text, 256, 50);
    return finish(c, false);
  });
}

/** Soft round sprite for particles and glows. */
export function glowTexture(): Texture {
  return cached('glow', () => {
    const [c, ctx] = canvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return finish(c, false);
  });
}

/** Swirling storm wall texture. */
export function stormTexture(): Texture {
  return cached('storm', () => {
    const [c, ctx] = canvas(256, 256);
    const rng = new Rng('storm');
    ctx.fillStyle = '#7a3cff';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = `rgba(${150 + rng.next() * 100},${60 + rng.next() * 60},255,${0.1 + rng.next() * 0.2})`;
      ctx.beginPath();
      ctx.ellipse(rng.next() * 256, rng.next() * 256, 20 + rng.next() * 60, 4 + rng.next() * 10, rng.next() * 3, 0, 7);
      ctx.fill();
    }
    return finish(c);
  });
}

/** Wispy cloud billboard. */
export function cloudTexture(): Texture {
  return cached('cloud', () => {
    const [c, ctx] = canvas(256, 128);
    const rng = new Rng('cloud');
    for (let i = 0; i < 14; i++) {
      const x = 40 + rng.next() * 176;
      const y = 50 + rng.next() * 40;
      const r = 20 + rng.next() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 128);
    }
    return finish(c, false);
  });
}
