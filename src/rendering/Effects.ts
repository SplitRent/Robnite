import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { glowTexture } from './textures';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  r: number; g: number; b: number;
  gravity: number;
}

interface Chunk {
  pos: Vector3;
  vel: Vector3;
  rot: Vector3;
  spin: Vector3;
  life: number;
  scale: number;
  color: Color;
}

interface Tracer {
  mesh: Mesh;
  life: number;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const UP = new Vector3(0, 0, 1);

/** Pooled lightweight effects: particles, debris chunks, tracers, flashes. */
export class Effects {
  readonly group = new Group();
  private particles: Particle[] = [];
  private maxParticles: number;
  private points: Points;
  private pGeo: BufferGeometry;
  private pPos: Float32Array;
  private pCol: Float32Array;
  private pSize: Float32Array;
  private chunks: Chunk[] = [];
  private chunkMesh: InstancedMesh;
  private maxChunks: number;
  private tracers: Tracer[] = [];
  private flashes: { mesh: Mesh; life: number }[] = [];
  private flashLight: PointLight | null = null;
  private flashLightLife = 0;
  intensity: number;

  constructor(quality: 'low' | 'medium' | 'high', effectsQuality: 'low' | 'medium' | 'high') {
    this.maxParticles = quality === 'low' ? 250 : quality === 'medium' ? 700 : 1400;
    this.maxChunks = quality === 'low' ? 60 : quality === 'medium' ? 140 : 260;
    this.intensity = quality === 'low' ? 0.5 : quality === 'medium' ? 0.8 : 1;
    this.pGeo = new BufferGeometry();
    this.pPos = new Float32Array(this.maxParticles * 3);
    this.pCol = new Float32Array(this.maxParticles * 4);
    this.pSize = new Float32Array(this.maxParticles);
    this.pGeo.setAttribute('position', new BufferAttribute(this.pPos, 3).setUsage(DynamicDrawUsage));
    this.pGeo.setAttribute('pcolor', new BufferAttribute(this.pCol, 4).setUsage(DynamicDrawUsage));
    this.pGeo.setAttribute('psize', new BufferAttribute(this.pSize, 1).setUsage(DynamicDrawUsage));
    const mat = new ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec4 pcolor; attribute float psize; varying vec4 vColor; uniform float scale;
        void main() {
          vColor = pcolor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec4 vColor;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.pGeo, mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    this.chunkMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ roughness: 0.8 }), this.maxChunks);
    this.chunkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.chunkMesh.count = 0;
    this.chunkMesh.frustumCulled = false;
    this.group.add(this.chunkMesh);

    const tracerGeo = new BoxGeometry(1, 1, 1);
    tracerGeo.translate(0, 0, 0.5);
    for (let i = 0; i < 40; i++) {
      const m = new Mesh(tracerGeo, new MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    const flashGeo = new PlaneGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const m = new Mesh(flashGeo, new MeshBasicMaterial({ map: glowTexture(), color: 0xffd27a, transparent: true, blending: AdditiveBlending, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.flashes.push({ mesh: m, life: 0 });
    }
    if (effectsQuality !== 'low') {
      this.flashLight = new PointLight(0xffc870, 0, 8, 2);
      this.group.add(this.flashLight);
    }
  }

  burst(pos: { x: number; y: number; z: number }, color: number, count: number, speed: number, size: number, life = 0.5, gravity = 9, spread = 1): void {
    const c = new Color(color);
    const n = Math.max(1, Math.round(count * this.intensity));
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= this.maxParticles) this.particles.shift();
      const dir = new Vector3(Math.random() - 0.5, Math.random() * spread, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.particles.push({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x, vy: dir.y, vz: dir.z, life: life * (0.6 + Math.random() * 0.6), max: life, size: size * (0.7 + Math.random() * 0.6), r: c.r, g: c.g, b: c.b, gravity });
    }
  }

  debris(pos: { x: number; y: number; z: number }, color: number, count: number, spreadBox = 1.5, scale = 0.25): void {
    const n = Math.max(1, Math.round(count * this.intensity));
    for (let i = 0; i < n; i++) {
      if (this.chunks.length >= this.maxChunks) this.chunks.shift();
      this.chunks.push({
        pos: new Vector3(pos.x + (Math.random() - 0.5) * spreadBox, pos.y + (Math.random() - 0.5) * spreadBox, pos.z + (Math.random() - 0.5) * spreadBox),
        vel: new Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 6),
        rot: new Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
        life: 0.9 + Math.random() * 0.5,
        scale: scale * (0.5 + Math.random()),
        color: new Color(color).multiplyScalar(0.8 + Math.random() * 0.4),
      });
    }
  }

  tracer(from: Vector3, to: Vector3, color = 0xfff1b0, width = 0.035): void {
    const t = this.tracers.find((x) => x.life <= 0) ?? this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    t.mesh.position.copy(from);
    t.mesh.scale.set(width, width, len);
    tmpV.subVectors(to, from).normalize();
    t.mesh.quaternion.setFromUnitVectors(UP, tmpV);
    (t.mesh.material as MeshBasicMaterial).color.setHex(color);
    t.mesh.visible = true;
    t.life = 0.07;
  }

  flash(pos: Vector3, size = 0.6, color = 0xffd27a): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.mesh.position.copy(pos);
    f.mesh.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    (f.mesh.material as MeshBasicMaterial).color.setHex(color);
    f.mesh.visible = true;
    f.life = 0.05;
    if (this.flashLight) {
      this.flashLight.position.copy(pos);
      this.flashLight.intensity = 6;
      this.flashLightLife = 0.05;
    }
  }

  update(dt: number, cameraQuat: Quaternion): void {
    // Particles
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
    for (const p of this.particles) {
      this.pPos[n * 3] = p.x;
      this.pPos[n * 3 + 1] = p.y;
      this.pPos[n * 3 + 2] = p.z;
      const a = Math.min(1, p.life / p.max);
      this.pCol[n * 4] = p.r;
      this.pCol[n * 4 + 1] = p.g;
      this.pCol[n * 4 + 2] = p.b;
      this.pCol[n * 4 + 3] = a;
      this.pSize[n] = p.size;
      n++;
    }
    this.pGeo.setDrawRange(0, n);
    (this.pGeo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.pGeo.getAttribute('pcolor') as BufferAttribute).needsUpdate = true;
    (this.pGeo.getAttribute('psize') as BufferAttribute).needsUpdate = true;

    // Debris chunks
    let ci = 0;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        this.chunks.splice(i, 1);
        continue;
      }
      c.vel.y -= 18 * dt;
      c.pos.addScaledVector(c.vel, dt);
      c.rot.addScaledVector(c.spin, dt);
    }
    for (const c of this.chunks) {
      tmpQ.setFromAxisAngle(tmpV.set(c.rot.x, c.rot.y, c.rot.z).normalize(), c.rot.length());
      const s = c.scale * Math.min(1, c.life * 3);
      tmpM.compose(c.pos, tmpQ, new Vector3(s, s, s));
      this.chunkMesh.setMatrixAt(ci, tmpM);
      this.chunkMesh.setColorAt(ci, c.color);
      ci++;
    }
    this.chunkMesh.count = ci;
    this.chunkMesh.instanceMatrix.needsUpdate = true;
    if (this.chunkMesh.instanceColor) this.chunkMesh.instanceColor.needsUpdate = true;

    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        (t.mesh.material as MeshBasicMaterial).opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    for (const f of this.flashes) {
      if (f.life > 0) {
        f.life -= dt;
        f.mesh.quaternion.copy(cameraQuat);
        if (f.life <= 0) f.mesh.visible = false;
      }
    }
    if (this.flashLight && this.flashLightLife > 0) {
      this.flashLightLife -= dt;
      if (this.flashLightLife <= 0) this.flashLight.intensity = 0;
    }
  }

  dispose(): void {
    this.pGeo.dispose();
    (this.points.material as ShaderMaterial).dispose();
    this.chunkMesh.geometry.dispose();
    (this.chunkMesh.material as MeshStandardMaterial).dispose();
    this.chunkMesh.dispose();
    for (const t of this.tracers) (t.mesh.material as MeshBasicMaterial).dispose();
    this.tracers[0]?.mesh.geometry.dispose();
    for (const f of this.flashes) (f.mesh.material as MeshBasicMaterial).dispose();
    this.flashes[0]?.mesh.geometry.dispose();
    this.group.removeFromParent();
  }
}
