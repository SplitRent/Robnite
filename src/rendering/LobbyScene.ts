import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  BoxGeometry,
  TorusGeometry,
  MeshBasicMaterial,
} from 'three';
import { Rng } from '../core/rng';
import { CharacterModel, emoteAnim, idleAnim } from './CharacterModel';
import type { CosmeticLoadout } from '../player/Combatant';
import { Sky, EVENING_SKY } from './Sky';
import { glowTexture } from './textures';

/**
 * The animated lobby backdrop: an evening cliffside platform with the
 * player's character on a pedestal, drifting particles, clouds and a slow
 * camera move. Rendered with the same WebGL renderer as matches.
 */
export class LobbyScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.1, 3000);
  private character: CharacterModel | null = null;
  private loadoutKey = '';
  private time = 0;
  private sky: Sky;
  private particles: Points;
  private emoteTime = -1;
  private emoteId = '';
  private disposables: { dispose(): void }[] = [];
  private ring: Mesh;
  private beacon: Mesh;
  /** Horizontal framing offset: positive shifts the character to the right of the screen. */
  frameOffset = 1.4;
  private currentOffset = 1.4;

  constructor(private shadows: boolean) {
    const s = this.scene;
    const sunDir = new Vector3(0.6, 0.18, -0.8).normalize();
    this.sky = new Sky(EVENING_SKY, sunDir, 1500, 14);
    s.add(this.sky.group);
    s.fog = new FogExp2(new Color(0x2a2340), 0.012);
    s.background = new Color(0x1b2040);
    s.add(new HemisphereLight(0x8fa8ff, 0x3a2a30, 0.9));
    s.add(new AmbientLight(0xffffff, 0.15));
    const key = new DirectionalLight(0xffc38a, 2.4);
    key.position.set(6, 8, 6);
    key.castShadow = shadows;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    s.add(key);
    const rim = new DirectionalLight(0x5ee7ff, 1.6);
    rim.position.set(-6, 4, -5);
    s.add(rim);
    const fill = new PointLight(0xff9d2e, 3, 12, 2);
    fill.position.set(2.5, 1.2, 3);
    s.add(fill);

    const mat = (color: number, opts: Partial<{ emissive: number; rough: number; metal: number }> = {}) => {
      const m = new MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0.05, emissive: opts.emissive ?? 0 });
      this.disposables.push(m);
      return m;
    };
    const geo = <T extends { dispose(): void }>(g: T) => {
      this.disposables.push(g);
      return g;
    };
    // Cliff platform
    const rock = new Mesh(geo(new CylinderGeometry(9, 6, 5, 10, 1)), mat(0x3a3a4a, { rough: 0.95 }));
    rock.position.y = -2.55;
    rock.receiveShadow = true;
    s.add(rock);
    const top = new Mesh(geo(new CylinderGeometry(9, 9, 0.12, 40)), mat(0x3f5a3a));
    top.position.y = -0.04;
    top.receiveShadow = true;
    s.add(top);
    // Pedestal
    const ped = new Mesh(geo(new CylinderGeometry(1.25, 1.4, 0.35, 32)), mat(0x1f2833, { metal: 0.5, rough: 0.35 }));
    ped.position.y = 0.17;
    ped.receiveShadow = true;
    ped.castShadow = true;
    s.add(ped);
    this.ring = new Mesh(geo(new TorusGeometry(1.33, 0.03, 8, 64)), new MeshBasicMaterial({ color: 0x5ee7ff }));
    this.disposables.push(this.ring.material as MeshBasicMaterial);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.36;
    s.add(this.ring);
    // Trees
    const rng = new Rng('lobby');
    const pine = geo(new ConeGeometry(1.1, 3.2, 7));
    const trunk = geo(new CylinderGeometry(0.15, 0.2, 1, 6));
    const leaf = mat(0x2f5a3a, { rough: 0.9 });
    const bark = mat(0x4a3322);
    for (let i = 0; i < 14; i++) {
      const a = 0.25 + (i / 14) * (Math.PI - 0.5);
      const r = 6.5 + rng.next() * 2.5;
      const g = new Group();
      const t = new Mesh(trunk, bark);
      t.position.y = 0.5;
      const c = new Mesh(pine, leaf);
      c.position.y = 2.3;
      c.castShadow = true;
      g.add(t, c);
      g.position.set(Math.cos(a) * r - 1, 0, -Math.sin(a) * r - 1.5);
      g.scale.setScalar(0.8 + rng.next() * 0.7);
      s.add(g);
    }
    // Rocks
    const rockGeo = geo(new IcosahedronGeometry(0.6, 0));
    const rockMat = mat(0x6e695e, { rough: 0.95 });
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(rockGeo, rockMat);
      const a = rng.next() * Math.PI * 2;
      m.position.set(Math.cos(a) * (3 + rng.next() * 5), 0.1, Math.sin(a) * (3 + rng.next() * 4) - 1);
      m.scale.set(0.6 + rng.next(), 0.4 + rng.next() * 0.5, 0.6 + rng.next());
      m.castShadow = true;
      s.add(m);
    }
    // Distant silhouettes: the valley below with Skyline's glowing tower.
    const far = new Group();
    const bmat = mat(0x252a45, { rough: 1 });
    const bgeo = geo(new BoxGeometry(1, 1, 1));
    for (let i = 0; i < 26; i++) {
      const b = new Mesh(bgeo, bmat);
      const w = 4 + rng.next() * 10;
      const hgt = 3 + rng.next() * 14;
      b.scale.set(w, hgt, w);
      b.position.set(-90 + i * 8 + rng.next() * 4, -18 + hgt / 2, -110 - rng.next() * 50);
      far.add(b);
    }
    const tower = new Mesh(geo(new CylinderGeometry(1.8, 2.2, 55, 12)), mat(0x2b3a4a));
    tower.position.set(30, 6, -140);
    far.add(tower);
    this.beacon = new Mesh(geo(new IcosahedronGeometry(3, 1)), new MeshBasicMaterial({ color: 0x9ef4ff }));
    this.disposables.push(this.beacon.material as MeshBasicMaterial);
    this.beacon.position.set(30, 36, -140);
    far.add(this.beacon);
    const beaconLight = new PointLight(0x5ee7ff, 40, 120, 1.5);
    beaconLight.position.copy(this.beacon.position);
    far.add(beaconLight);
    const mountains = geo(new ConeGeometry(60, 50, 5));
    const mmat = mat(0x1d2140, { rough: 1 });
    for (let i = 0; i < 6; i++) {
      const m = new Mesh(mountains, mmat);
      m.position.set(-220 + i * 90, 0, -330 - (i % 2) * 60);
      m.scale.set(1 + (i % 3) * 0.4, 1 + (i % 2) * 0.6, 1);
      far.add(m);
    }
    s.add(far);
    // Floating particles (fireflies / embers)
    const n = 180;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rng.next() - 0.5) * 18;
      pos[i * 3 + 1] = rng.next() * 6;
      pos[i * 3 + 2] = (rng.next() - 0.5) * 14 - 2;
    }
    const pg = geo(new BufferGeometry());
    pg.setAttribute('position', new BufferAttribute(pos, 3));
    const pm = new PointsMaterial({ map: glowTexture(), color: 0xffd9a0, size: 0.14, transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.disposables.push(pm);
    this.particles = new Points(pg, pm);
    s.add(this.particles);
  }

  setLoadout(loadout: CosmeticLoadout): void {
    const key = JSON.stringify(loadout);
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    this.character?.dispose();
    this.character = new CharacterModel(loadout, this.shadows);
    this.character.root.position.set(0, 0.35, 0);
    this.character.root.rotation.y = Math.PI + 0.35;
    this.character.setHeld('pickaxe');
    this.scene.add(this.character.root);
  }

  playEmote(id: string): void {
    this.emoteId = id;
    this.emoteTime = 0;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  frame(dt: number, reducedMotion: boolean): void {
    this.time += dt;
    const t = this.time;
    const drift = reducedMotion ? 0 : 1;
    const target = new Vector3(0, 1.05, 0);
    this.currentOffset += (this.frameOffset - this.currentOffset) * Math.min(1, dt * 4);
    this.camera.position.set(-this.currentOffset + Math.sin(t * 0.1) * 0.4 * drift, 1.7 + Math.sin(t * 0.13) * 0.08 * drift, 7.6);
    this.camera.lookAt(target.x - this.currentOffset, target.y, target.z);
    this.sky.update(dt, this.camera.position);
    if (this.character) {
      const a = idleAnim();
      a.held = 'pickaxe';
      if (this.emoteTime >= 0) {
        this.emoteTime += dt;
        a.emote = emoteAnim(this.emoteId);
        a.emoteTime = this.emoteTime;
        a.held = 'none';
        if (this.emoteTime > 4) this.emoteTime = -1;
      }
      this.character.update(dt, a);
      this.character.root.rotation.y = Math.PI + 0.35 + Math.sin(t * 0.3) * 0.08 * drift;
    }
    const p = this.particles.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) + dt * 0.25 * drift;
      if (y > 6) y = 0;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(t + i) * 0.002 * drift);
    }
    p.needsUpdate = true;
    this.ring.scale.setScalar(1 + Math.sin(t * 2) * 0.02);
    this.beacon.scale.setScalar(1 + Math.sin(t * 1.5) * 0.08);
  }

  dispose(): void {
    this.character?.dispose();
    this.sky.dispose();
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
  }
}
