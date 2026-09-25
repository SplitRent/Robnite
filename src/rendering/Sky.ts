import { BackSide, Color, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, SphereGeometry, Group, DoubleSide, Vector3 } from 'three';
import { cloudTexture } from './textures';
import { Rng } from '../core/rng';

export interface SkyPalette {
  top: number;
  horizon: number;
  bottom: number;
  sun: number;
}

export const DAY_SKY: SkyPalette = { top: 0x3f7fd0, horizon: 0xcfe3f2, bottom: 0xe9dcc8, sun: 0xfff1d0 };
export const EVENING_SKY: SkyPalette = { top: 0x1b2450, horizon: 0xf09a6a, bottom: 0x3a2a3a, sun: 0xffc38a };

/** Gradient sky dome with a sun glow plus drifting cloud billboards. */
export class Sky {
  readonly group = new Group();
  private dome: Mesh;
  private clouds: Mesh[] = [];
  readonly material: ShaderMaterial;

  constructor(palette: SkyPalette, sunDir: Vector3, radius = 1800, cloudCount = 18) {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new Color(palette.top) },
        horizon: { value: new Color(palette.horizon) },
        bottom: { value: new Color(palette.bottom) },
        sunColor: { value: new Color(palette.sun) },
        sunDir: { value: sunDir.clone().normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunColor; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h * 3.0, 0.0, 1.0), 0.6));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new Mesh(new SphereGeometry(radius, 32, 16), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.group.add(this.dome);
    const tex = cloudTexture();
    const rng = new Rng('clouds');
    const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, side: DoubleSide, fog: false });
    for (let i = 0; i < cloudCount; i++) {
      const w = 160 + rng.next() * 220;
      const m = new Mesh(new PlaneGeometry(w, w * 0.4), mat);
      const a = rng.next() * Math.PI * 2;
      const r = radius * (0.45 + rng.next() * 0.35);
      m.position.set(Math.cos(a) * r, 180 + rng.next() * 160, Math.sin(a) * r);
      m.lookAt(0, m.position.y * 0.3, 0);
      m.userData.speed = 2 + rng.next() * 4;
      m.userData.angle = a;
      m.userData.r = r;
      this.clouds.push(m);
      this.group.add(m);
    }
  }

  update(dt: number, cameraPos: Vector3): void {
    this.group.position.set(cameraPos.x, 0, cameraPos.z);
    for (const c of this.clouds) {
      c.userData.angle += (c.userData.speed * dt) / c.userData.r;
      c.position.x = Math.cos(c.userData.angle) * c.userData.r;
      c.position.z = Math.sin(c.userData.angle) * c.userData.r;
      c.lookAt(0, c.position.y * 0.3, 0);
    }
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.material.dispose();
    for (const c of this.clouds) c.geometry.dispose();
  }
}
