import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  type Material,
} from 'three';
import { cosmetic, outfitLook, type BackpackLook, type GliderLook, type OutfitLook, type PickaxeLook, type WrapLook, type EmoteLook } from '../cosmetics/catalog';
import type { CosmeticLoadout } from '../player/Combatant';
import type { WeaponId } from '../inventory/items';
import { glowTexture } from './textures';

export type HeldItem = WeaponId | 'pickaxe' | 'consumable' | 'build' | 'none';

export interface AnimState {
  speed: number;
  grounded: boolean;
  crouch: boolean;
  sliding: boolean;
  air: 'none' | 'bus' | 'skydive' | 'glide';
  pitch: number;
  sinceShot: number;
  reloading: boolean;
  sinceSwing: number;
  sinceBuild: number;
  usingItem: boolean;
  emote: string | null;
  emoteTime: number;
  dead: boolean;
  sinceDeath: number;
  held: HeldItem;
  aiming: boolean;
  /** Local-space movement direction (for strafing leg angles). */
  strafe: number;
}

export function idleAnim(): AnimState {
  return { speed: 0, grounded: true, crouch: false, sliding: false, air: 'none', pitch: 0, sinceShot: 9, reloading: false, sinceSwing: 9, sinceBuild: 9, usingItem: false, emote: null, emoteTime: 0, dead: false, sinceDeath: 0, held: 'none', aiming: false, strafe: 0 };
}

// Shared geometry (unit boxes scaled per part).
const unitBox = new BoxGeometry(1, 1, 1);
const unitSphere = new SphereGeometry(0.5, 12, 10);
const unitCyl = new CylinderGeometry(0.5, 0.5, 1, 10);

function box(mat: Material, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(unitBox, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function std(color: number, opts: { emissive?: boolean; metal?: number; rough?: number } = {}): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: opts.rough ?? 0.7,
    metalness: opts.metal ?? 0.05,
    emissive: opts.emissive ? new Color(color).multiplyScalar(0.6) : new Color(0),
  });
}

/** Weapon mesh built from primitives. Muzzle marker at userData.muzzle. */
export function buildWeaponMesh(id: WeaponId, wrap: WrapLook): Group {
  const g = new Group();
  const body = std(wrap.color, { metal: 0.4, rough: 0.45, emissive: false });
  const accent = std(wrap.color2, { emissive: wrap.emissive, metal: 0.3, rough: 0.5 });
  const dark = std(0x1c1f24, { metal: 0.3, rough: 0.6 });
  const add = (m: Mesh) => {
    g.add(m);
    return m;
  };
  let muzzleZ = -0.6;
  switch (id) {
    case 'ar':
      add(box(body, 0.08, 0.12, 0.62, 0, 0, -0.2));
      add(box(dark, 0.05, 0.05, 0.3, 0, 0.03, -0.62));
      add(box(accent, 0.07, 0.16, 0.08, 0, -0.12, -0.12));
      add(box(dark, 0.06, 0.12, 0.06, 0, -0.1, 0.02));
      add(box(body, 0.07, 0.1, 0.22, 0, -0.01, 0.2));
      add(box(accent, 0.05, 0.05, 0.18, 0, 0.1, -0.2));
      muzzleZ = -0.78;
      break;
    case 'smg':
      add(box(body, 0.08, 0.13, 0.42, 0, 0, -0.12));
      add(box(dark, 0.05, 0.05, 0.16, 0, 0.02, -0.4));
      add(box(accent, 0.06, 0.2, 0.06, 0, -0.14, -0.1));
      add(box(dark, 0.06, 0.12, 0.06, 0, -0.1, 0.05));
      muzzleZ = -0.5;
      break;
    case 'shotgun':
      add(box(body, 0.09, 0.11, 0.72, 0, 0, -0.26));
      add(box(dark, 0.07, 0.07, 0.42, 0, -0.08, -0.36));
      add(box(accent, 0.1, 0.1, 0.16, 0, -0.08, -0.34));
      add(box(body, 0.07, 0.14, 0.24, 0, -0.04, 0.2));
      muzzleZ = -0.64;
      break;
    case 'marksman':
      add(box(body, 0.08, 0.12, 0.9, 0, 0, -0.3));
      add(box(dark, 0.045, 0.045, 0.3, 0, 0.02, -0.88));
      add(box(dark, 0.07, 0.07, 0.3, 0, 0.13, -0.2));
      add(box(accent, 0.09, 0.09, 0.05, 0, 0.13, -0.36));
      add(box(accent, 0.07, 0.14, 0.26, 0, -0.03, 0.25));
      muzzleZ = -1.05;
      break;
  }
  const muzzle = new Object3D();
  muzzle.position.set(0, 0.02, muzzleZ);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

export function buildPickaxeMesh(look: PickaxeLook): Group {
  const g = new Group();
  const handle = std(look.handle, { rough: 0.8 });
  const head = std(look.head, { metal: 0.5, rough: 0.35, emissive: look.glow });
  g.add(box(handle, 0.05, 0.9, 0.05, 0, 0.35, 0));
  switch (look.shape) {
    case 'pick':
      g.add(box(head, 0.06, 0.1, 0.7, 0, 0.78, 0));
      g.add(box(head, 0.05, 0.06, 0.2, 0, 0.75, -0.42));
      break;
    case 'axe':
      g.add(box(head, 0.05, 0.36, 0.3, 0, 0.72, -0.16));
      g.add(box(head, 0.06, 0.1, 0.14, 0, 0.78, 0.1));
      break;
    case 'hammer':
      g.add(box(head, 0.2, 0.2, 0.44, 0, 0.78, 0));
      break;
    case 'scythe':
      g.add(box(head, 0.04, 0.08, 0.6, 0, 0.82, -0.28));
      g.add(box(head, 0.04, 0.22, 0.08, 0, 0.72, -0.56));
      break;
  }
  return g;
}

function buildBackpack(look: BackpackLook): Group {
  const g = new Group();
  if (look.shape === 'none') return g;
  const a = std(look.color, { rough: 0.6 });
  const b = std(look.color2, { emissive: look.shape === 'cell' || look.shape === 'core', rough: 0.5 });
  switch (look.shape) {
    case 'pack':
      g.add(box(a, 0.36, 0.4, 0.16, 0, 0, 0));
      g.add(box(b, 0.3, 0.08, 0.17, 0, -0.1, 0.01));
      break;
    case 'cell':
      g.add(box(a, 0.3, 0.44, 0.14));
      g.add(box(b, 0.12, 0.36, 0.16, 0, 0, 0.01));
      break;
    case 'satchel':
      g.add(box(a, 0.28, 0.24, 0.12, 0.05, -0.1, 0));
      g.add(box(b, 0.28, 0.06, 0.13, 0.05, 0.02, 0));
      break;
    case 'antenna':
      g.add(box(a, 0.3, 0.34, 0.14));
      g.add(box(a, 0.03, 0.7, 0.03, 0.1, 0.45, 0));
      g.add(box(b, 0.06, 0.06, 0.06, 0.1, 0.82, 0));
      break;
    case 'fins':
      g.add(box(a, 0.08, 0.5, 0.3, -0.14, 0.05, 0.1));
      g.add(box(a, 0.08, 0.5, 0.3, 0.14, 0.05, 0.1));
      g.add(box(b, 0.2, 0.2, 0.1));
      break;
    case 'crate':
      g.add(box(a, 0.34, 0.3, 0.22));
      g.add(box(b, 0.36, 0.05, 0.24, 0, 0.1, 0));
      break;
    case 'core': {
      g.add(box(a, 0.26, 0.4, 0.14));
      const orb = new Mesh(unitSphere, b);
      orb.scale.setScalar(0.2);
      orb.position.set(0, 0, 0.1);
      g.add(orb);
      break;
    }
  }
  return g;
}

function buildGlider(look: GliderLook): Group {
  const g = new Group();
  const a = new MeshStandardMaterial({ color: look.color, side: DoubleSide, roughness: 0.6 });
  const b = new MeshStandardMaterial({ color: look.color2, side: DoubleSide, roughness: 0.6 });
  if (look.shape === 'chute') {
    const dome = new Mesh(new SphereGeometry(1.6, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), a);
    dome.scale.set(1.2, 0.5, 0.8);
    dome.position.y = 2.2;
    g.add(dome);
    const stripe = new Mesh(new SphereGeometry(1.62, 16, 2, 0, Math.PI * 2, Math.PI / 5, 0.12), b);
    stripe.scale.set(1.2, 0.5, 0.8);
    stripe.position.y = 2.2;
    g.add(stripe);
  } else if (look.shape === 'wing') {
    g.add(box(a, 3.4, 0.06, 1.1, 0, 2.2, 0));
    g.add(box(b, 3.4, 0.08, 0.2, 0, 2.22, -0.5));
  } else {
    const tri = new Mesh(new ConeGeometry(1.8, 0.2, 3), a);
    tri.rotation.y = Math.PI;
    tri.scale.set(1, 1, 1.2);
    tri.position.y = 2.2;
    g.add(tri);
    g.add(box(b, 2.2, 0.1, 0.12, 0, 2.3, 0.4));
  }
  // Rigging lines
  const line = std(0xdddddd);
  for (const x of [-1, 1]) {
    const l = box(line, 0.015, 1.5, 0.015, x * 0.7, 1.45, 0);
    l.rotation.z = x * 0.45;
    g.add(l);
  }
  return g;
}

interface Limb {
  pivot: Group;
  lower: Group;
}

/**
 * Stylised modular character assembled from primitives and dressed by the
 * equipped cosmetics. Animation is procedural.
 */
export class CharacterModel {
  readonly root = new Group();
  private body = new Group();
  private hips = new Group();
  private torso = new Group();
  private head = new Group();
  private armL!: Limb;
  private armR!: Limb;
  private legL!: Limb;
  private legR!: Limb;
  private handR = new Group();
  private backpack = new Group();
  private glider: Group;
  private held: HeldItem = 'none';
  private heldMesh: Group | null = null;
  private weaponCache = new Map<string, Group>();
  private pickaxe: Group;
  private consumable: Mesh;
  private buildTool: Mesh;
  private materials: Material[] = [];
  private phase = 0;
  private look: OutfitLook;
  private wrap: WrapLook;
  private shadowBlob: Mesh;
  private trail: Mesh;
  muzzleWorld = new Object3D();

  constructor(readonly cosmetics: CosmeticLoadout, castShadow = true) {
    this.look = outfitLook(cosmetics.outfit);
    this.wrap = (cosmetic(cosmetics.wrap)?.look as WrapLook) ?? { color: 0x2d3238, color2: 0x4b5563, emissive: false };
    const L = this.look;
    const skin = this.track(std(L.skin, { rough: 0.8 }));
    const primary = this.track(std(L.primary, { rough: 0.75 }));
    const secondary = this.track(std(L.secondary, { rough: 0.8 }));
    const accent = this.track(std(L.accent, { emissive: L.glow, rough: 0.5 }));
    const hair = this.track(std(L.hair, { rough: 0.9 }));
    const dark = this.track(std(0x1a1d22, { rough: 0.8 }));
    const wide = L.body === 'a' ? 1 : 0.88;

    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = 0.92;
    // Pelvis / belt
    this.hips.add(box(secondary, 0.4 * wide, 0.16, 0.24, 0, 0, 0));
    this.hips.add(box(accent, 0.42 * wide, 0.05, 0.25, 0, 0.07, 0));
    // Torso
    this.torso.position.y = 0.08;
    this.hips.add(this.torso);
    this.torso.add(box(primary, 0.46 * wide, 0.5, 0.26, 0, 0.27, 0));
    this.torso.add(box(accent, 0.2 * wide, 0.1, 0.02, 0.08, 0.38, -0.135));
    this.torso.add(box(secondary, 0.46 * wide, 0.1, 0.27, 0, 0.05, 0));
    switch (L.style) {
      case 'heavy':
        this.torso.add(box(secondary, 0.2, 0.12, 0.3, -0.3 * wide, 0.5, 0));
        this.torso.add(box(secondary, 0.2, 0.12, 0.3, 0.3 * wide, 0.5, 0));
        this.torso.add(box(accent, 0.34 * wide, 0.28, 0.04, 0, 0.3, -0.14));
        break;
      case 'scout':
        this.torso.add(box(accent, 0.36, 0.1, 0.3, 0, 0.5, 0));
        break;
      case 'tech':
        this.torso.add(box(accent, 0.03, 0.46, 0.02, -0.12, 0.27, -0.135));
        this.torso.add(box(accent, 0.03, 0.46, 0.02, 0.12, 0.27, -0.135));
        break;
      case 'ranger':
        this.torso.add(box(secondary, 0.5 * wide, 0.62, 0.05, 0, 0.18, 0.15));
        break;
      case 'punk':
        for (let i = 0; i < 4; i++) this.torso.add(box(accent, 0.05, 0.08, 0.05, -0.15 + i * 0.1, 0.56, 0.08));
        break;
      case 'marshal':
        this.torso.add(box(secondary, 0.48 * wide, 0.6, 0.04, 0, 0.12, 0.14));
        this.torso.add(box(accent, 0.07, 0.07, 0.02, -0.12, 0.4, -0.135));
        break;
      default:
        this.torso.add(box(secondary, 0.3 * wide, 0.14, 0.02, 0, 0.18, -0.135));
    }
    // Head
    this.head.position.y = 0.56;
    this.torso.add(this.head);
    this.head.add(box(skin, 0.1, 0.08, 0.1, 0, 0.02, 0));
    this.head.add(box(skin, 0.27, 0.29, 0.27, 0, 0.19, 0));
    this.head.add(box(dark, 0.05, 0.05, 0.01, -0.065, 0.2, -0.137));
    this.head.add(box(dark, 0.05, 0.05, 0.01, 0.065, 0.2, -0.137));
    this.head.add(box(hair, 0.29, 0.08, 0.29, 0, 0.33, 0.005));
    this.head.add(box(hair, 0.29, 0.18, 0.06, 0, 0.26, 0.12));
    switch (L.head) {
      case 'cap':
        this.head.add(box(primary, 0.3, 0.09, 0.3, 0, 0.36, 0));
        this.head.add(box(accent, 0.24, 0.03, 0.14, 0, 0.33, -0.2));
        break;
      case 'helmet':
        this.head.add(box(secondary, 0.33, 0.2, 0.33, 0, 0.3, 0));
        this.head.add(box(accent, 0.3, 0.06, 0.02, 0, 0.24, -0.17));
        break;
      case 'visor':
        this.head.add(box(accent, 0.3, 0.07, 0.03, 0, 0.21, -0.14));
        break;
      case 'hood':
        this.head.add(box(secondary, 0.33, 0.3, 0.33, 0, 0.24, 0.02));
        this.head.add(box(skin, 0.24, 0.2, 0.02, 0, 0.18, -0.15));
        break;
      case 'beanie':
        this.head.add(box(accent, 0.31, 0.12, 0.31, 0, 0.36, 0));
        break;
      case 'crown':
        for (let i = 0; i < 5; i++) this.head.add(box(accent, 0.05, 0.1, 0.05, -0.12 + i * 0.06, 0.4, -0.08));
        break;
      case 'mask':
        this.head.add(box(dark, 0.28, 0.12, 0.02, 0, 0.12, -0.14));
        break;
      case 'goggles':
        this.head.add(box(dark, 0.3, 0.05, 0.3, 0, 0.26, 0));
        this.head.add(box(accent, 0.09, 0.07, 0.02, -0.065, 0.26, -0.152));
        this.head.add(box(accent, 0.09, 0.07, 0.02, 0.065, 0.26, -0.152));
        break;
      default:
        break;
    }
    // Arms
    const mkArm = (side: number): Limb => {
      const pivot = new Group();
      pivot.position.set(side * 0.3 * wide, 0.47, 0);
      this.torso.add(pivot);
      pivot.add(box(primary, 0.13, 0.3, 0.13, 0, -0.14, 0));
      const lower = new Group();
      lower.position.y = -0.29;
      pivot.add(lower);
      lower.add(box(secondary, 0.12, 0.28, 0.12, 0, -0.13, 0));
      lower.add(box(skin, 0.1, 0.1, 0.1, 0, -0.3, 0));
      return { pivot, lower };
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.handR.position.set(0, -0.32, -0.02);
    this.armR.lower.add(this.handR);
    // Legs
    const mkLeg = (side: number): Limb => {
      const pivot = new Group();
      pivot.position.set(side * 0.11 * wide, -0.06, 0);
      this.hips.add(pivot);
      pivot.add(box(secondary, 0.16, 0.44, 0.17, 0, -0.22, 0));
      const lower = new Group();
      lower.position.y = -0.44;
      pivot.add(lower);
      lower.add(box(primary, 0.15, 0.4, 0.16, 0, -0.2, 0));
      lower.add(box(dark, 0.17, 0.1, 0.25, 0, -0.42, -0.04));
      return { pivot, lower };
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    // Backpack
    const bp = buildBackpack((cosmetic(cosmetics.backpack)?.look as BackpackLook) ?? { shape: 'none', color: 0, color2: 0 });
    this.backpack.add(bp);
    this.backpack.position.set(0, 0.3, 0.2);
    this.torso.add(this.backpack);
    // Held items
    this.pickaxe = buildPickaxeMesh((cosmetic(cosmetics.pickaxe)?.look as PickaxeLook) ?? { head: 0x9aa4ad, handle: 0x5b3a22, shape: 'pick' });
    this.pickaxe.rotation.x = -Math.PI / 2;
    this.pickaxe.position.set(0, 0, 0.3);
    this.consumable = new Mesh(unitCyl, this.track(std(0x3f9dff, { emissive: true })));
    this.consumable.scale.set(0.12, 0.22, 0.12);
    this.buildTool = new Mesh(unitBox, this.track(new MeshStandardMaterial({ color: 0x5ee7ff, emissive: 0x2a8fa0, transparent: true, opacity: 0.8 })));
    this.buildTool.scale.set(0.16, 0.1, 0.22);
    // Glider
    this.glider = buildGlider((cosmetic(cosmetics.glider)?.look as GliderLook) ?? { color: 0x3d6fa8, color2: 0xffffff, shape: 'chute' });
    this.glider.visible = false;
    this.root.add(this.glider);
    // Contact shadow blob (cheap AO under the character)
    this.shadowBlob = new Mesh(new PlaneGeometry(0.9, 0.9), this.track(new MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })));
    this.shadowBlob.rotation.x = -Math.PI / 2;
    this.shadowBlob.position.y = 0.03;
    this.root.add(this.shadowBlob);
    // Air trail
    this.trail = new Mesh(new PlaneGeometry(0.3, 4), this.track(new MeshBasicMaterial({ map: glowTexture(), color: 0xbfefff, transparent: true, opacity: 0.4, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })));
    this.trail.position.set(0, 3, 0);
    this.trail.visible = false;
    this.root.add(this.trail);
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) (o as Mesh).castShadow = castShadow && o !== this.shadowBlob && o !== this.trail;
    });
    this.handR.add(this.muzzleWorld);
  }

  private track<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  /** Swap the held item mesh. */
  setHeld(item: HeldItem): void {
    if (item === this.held) return;
    this.held = item;
    if (this.heldMesh) this.handR.remove(this.heldMesh);
    this.handR.remove(this.consumable, this.buildTool);
    this.heldMesh = null;
    if (item === 'pickaxe') {
      this.heldMesh = this.pickaxe;
    } else if (item === 'consumable') {
      this.handR.add(this.consumable);
    } else if (item === 'build') {
      this.handR.add(this.buildTool);
    } else if (item !== 'none') {
      let w = this.weaponCache.get(item);
      if (!w) {
        w = buildWeaponMesh(item, this.wrap);
        w.rotation.x = -Math.PI / 2;
        w.position.set(0, -0.02, 0.05);
        w.traverse((o) => ((o as Mesh).castShadow = true));
        this.weaponCache.set(item, w);
      }
      this.heldMesh = w;
    }
    if (this.heldMesh) this.handR.add(this.heldMesh);
  }

  /** World position of the muzzle (for tracers). */
  muzzlePosition(out: import('three').Vector3): import('three').Vector3 {
    const m = this.heldMesh?.userData.muzzle as Object3D | undefined;
    return (m ?? this.handR).getWorldPosition(out);
  }

  /*
   * Pose conventions (rotation.x on a limb pivot): positive swings the limb
   * FORWARD (toward the character's face, -Z) and up; negative swings it back.
   * Elbows/knees: lower.rotation.x > 0 bends forward (elbow), < 0 bends back (knee).
   * rotation.z on an arm swings it sideways: + toward +X, − toward −X.
   */
  update(dt: number, a: AnimState): void {
    this.setHeld(a.held);
    const moving = a.speed > 0.3 && a.grounded;
    this.phase += dt * (moving ? Math.min(a.speed, 9) * 1.55 : 1.4);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const run = Math.min(1, a.speed / 7.5);

    // Reset
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.hips.position.y = 0.92;
    this.torso.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    for (const limb of [this.armL, this.armR, this.legL, this.legR]) {
      limb.pivot.rotation.set(0, 0, 0);
      limb.lower.rotation.set(0, 0, 0);
    }
    this.glider.visible = a.air === 'glide';
    this.trail.visible = a.air === 'skydive' || a.air === 'glide';
    this.shadowBlob.visible = a.grounded && !a.dead;

    if (a.dead) {
      const t = Math.min(1, a.sinceDeath / 0.5);
      this.body.rotation.x = -t * (Math.PI / 2) * 0.95;
      this.body.position.y = t * 0.15;
      this.armL.pivot.rotation.z = -0.6 * t;
      this.armR.pivot.rotation.z = 0.6 * t;
      return;
    }

    if (a.air === 'skydive') {
      // Belly down, head leading, arms and legs spread.
      this.body.rotation.x = -1.35;
      this.body.position.y = 1.0;
      this.armL.pivot.rotation.z = -1.2 + s * 0.08;
      this.armR.pivot.rotation.z = 1.2 - s * 0.08;
      this.armL.pivot.rotation.x = 0.4;
      this.armR.pivot.rotation.x = 0.4;
      this.legL.pivot.rotation.z = -0.25;
      this.legR.pivot.rotation.z = 0.25;
      this.legL.lower.rotation.x = -0.3 + s * 0.1;
      this.legR.lower.rotation.x = -0.3 - s * 0.1;
      this.head.rotation.x = 0.9;
      return;
    }
    if (a.air === 'glide') {
      // Hanging from the glider handles.
      this.armL.pivot.rotation.set(0, 0, -2.75);
      this.armR.pivot.rotation.set(0, 0, 2.75);
      this.legL.pivot.rotation.x = -0.1 + s * 0.05;
      this.legR.pivot.rotation.x = 0.1 - s * 0.05;
      this.legL.lower.rotation.x = -0.25;
      this.glider.rotation.z = Math.sin(this.phase * 0.5) * 0.05;
      return;
    }

    // ---- Legs
    if (a.sliding) {
      this.body.rotation.x = 0.3;
      this.hips.position.y = 0.55;
      this.legL.pivot.rotation.x = 1.3;
      this.legR.pivot.rotation.x = 0.9;
      this.legR.lower.rotation.x = -0.8;
    } else if (!a.grounded) {
      this.legL.pivot.rotation.x = 0.7;
      this.legL.lower.rotation.x = -1.0;
      this.legR.pivot.rotation.x = -0.2;
      this.legR.lower.rotation.x = -0.4;
    } else if (moving) {
      const amp = 0.45 + run * 0.35;
      this.legL.pivot.rotation.x = s * amp;
      this.legR.pivot.rotation.x = -s * amp;
      // Knees bend backwards, most while the leg swings through.
      this.legL.lower.rotation.x = -Math.max(0, -c) * amp * 1.3;
      this.legR.lower.rotation.x = -Math.max(0, c) * amp * 1.3;
      this.hips.position.y = 0.92 + Math.abs(c) * 0.05 * run;
      this.torso.rotation.x = 0.06 * run;
      this.body.rotation.y = a.strafe * 0.35;
    }
    if (a.crouch && !a.sliding) {
      this.hips.position.y -= 0.36;
      this.legL.pivot.rotation.x += 0.95;
      this.legR.pivot.rotation.x += 0.55;
      this.legL.lower.rotation.x -= 1.35;
      this.legR.lower.rotation.x -= 1.0;
      this.torso.rotation.x = 0.22;
    }

    // ---- Upper body
    const pitch = Math.max(-1, Math.min(1, a.pitch));
    if (a.emote) {
      this.animateEmote(a.emote, a.emoteTime);
      return;
    }
    const hasGun = a.held !== 'none' && a.held !== 'pickaxe' && a.held !== 'consumable' && a.held !== 'build';
    if (hasGun) {
      // Rifle shouldered on the right: chest bladed slightly right, right
      // elbow bent so the stock sits at the shoulder, left hand on the barrel.
      const kick = Math.max(0, 1 - a.sinceShot / 0.1) * 0.12;
      const aimUp = pitch * 0.9;
      this.torso.rotation.y = -0.3;
      this.head.rotation.y = 0.3;
      this.armR.pivot.rotation.z = -0.05;
      this.armR.pivot.rotation.x = 0.6 + aimUp + kick;
      this.armR.lower.rotation.x = Math.PI / 2 - 0.6;
      this.armR.lower.rotation.y = -0.25;
      this.armL.pivot.rotation.z = 0.95;
      this.armL.pivot.rotation.x = 1.3 + aimUp + kick;
      this.armL.lower.rotation.x = 0.3;
      if (a.reloading) {
        this.armL.pivot.rotation.x = 0.6 + Math.sin(this.phase * 5) * 0.25;
        this.armL.pivot.rotation.z = 0.5;
        this.armR.lower.rotation.x = Math.PI / 2 - 0.9;
      }
    } else if (a.held === 'pickaxe') {
      const sw = a.sinceSwing < 0.45 ? Math.sin((a.sinceSwing / 0.45) * Math.PI) : 0;
      // Raised back over the shoulder, then chopped forward.
      this.armR.pivot.rotation.x = sw > 0 ? 2.4 - (a.sinceSwing / 0.45) * 2.6 + pitch * 0.4 : 0.45 + pitch * 0.4;
      this.armR.lower.rotation.x = 0.5;
      this.armL.pivot.rotation.x = moving ? s * 0.6 * run : 0.15;
      this.torso.rotation.y = sw * 0.35;
    } else if (a.held === 'build') {
      const push = Math.max(0, 1 - a.sinceBuild / 0.18);
      this.armR.pivot.rotation.x = 1.15 + pitch * 0.6 + push * 0.3;
      this.armR.pivot.rotation.z = 0.2;
      this.armL.pivot.rotation.x = 1.0 + pitch * 0.6 + push * 0.3;
      this.armL.pivot.rotation.z = -0.25;
    } else if (a.held === 'consumable') {
      this.armR.pivot.rotation.x = a.usingItem ? 1.5 + Math.sin(this.phase * 3) * 0.1 : 0.6;
      this.armR.lower.rotation.x = a.usingItem ? 0.9 : 0.3;
      this.armL.pivot.rotation.x = a.usingItem ? 1.1 : moving ? s * 0.5 : 0;
      this.armL.pivot.rotation.z = a.usingItem ? -0.5 : 0;
    } else {
      this.armL.pivot.rotation.x = moving ? -s * 0.7 * run : Math.sin(this.phase) * 0.03;
      this.armR.pivot.rotation.x = moving ? s * 0.7 * run : -Math.sin(this.phase) * 0.03;
      this.armL.lower.rotation.x = 0.3;
      this.armR.lower.rotation.x = 0.3;
    }
    this.head.rotation.x = pitch * 0.5;
    if (!moving && a.grounded && !a.crouch) this.torso.rotation.x += Math.sin(this.phase * 0.8) * 0.015;
  }

  private animateEmote(anim: string, t: number): void {
    const s = Math.sin(t * 8);
    switch (anim) {
      case 'wave':
        this.armR.pivot.rotation.z = 2.6;
        this.armR.lower.rotation.z = s * 0.5;
        break;
      case 'victory':
        this.armR.pivot.rotation.z = 2.8;
        this.armL.pivot.rotation.z = -0.4;
        this.torso.rotation.y = Math.min(0.4, t);
        this.body.position.y = Math.max(0, Math.sin(Math.min(t, 0.4) * 8) * 0.2);
        break;
      case 'point':
        this.armR.pivot.rotation.x = Math.PI / 2;
        this.armL.pivot.rotation.z = -0.2;
        this.head.rotation.y = Math.sin(t * 2) * 0.2;
        break;
      case 'dance':
        this.body.rotation.y = Math.sin(t * 5) * 0.4;
        this.hips.position.y = 0.92 - Math.abs(Math.sin(t * 5)) * 0.12;
        this.armL.pivot.rotation.z = -1.2 + Math.sin(t * 10) * 0.6;
        this.armR.pivot.rotation.z = 1.2 - Math.cos(t * 10) * 0.6;
        this.legL.pivot.rotation.x = Math.max(0, Math.sin(t * 10)) * 0.6;
        this.legR.pivot.rotation.x = Math.max(0, -Math.sin(t * 10)) * 0.6;
        break;
      case 'celebrate':
        this.armL.pivot.rotation.z = -2.7 + s * 0.2;
        this.armR.pivot.rotation.z = 2.7 - s * 0.2;
        this.body.position.y = Math.abs(Math.sin(t * 6)) * 0.3;
        break;
      case 'thumbs':
        this.armR.pivot.rotation.x = 1.3;
        this.armR.lower.rotation.x = 0.7;
        this.head.rotation.x = Math.sin(t * 3) * 0.1;
        break;
      case 'salute':
        this.armR.pivot.rotation.set(1.3, 0, 0.9);
        this.armR.lower.rotation.x = 2.1;
        break;
      case 'robot': {
        const step = Math.floor(t * 4) % 4;
        this.armL.pivot.rotation.x = step % 2 ? 1.57 : 0;
        this.armR.pivot.rotation.x = step % 2 ? 0 : 1.57;
        this.armL.lower.rotation.x = 1.57;
        this.armR.lower.rotation.x = 1.57;
        this.head.rotation.y = step < 2 ? 0.5 : -0.5;
        break;
      }
      case 'spin':
        this.body.rotation.y = t * 9;
        this.armL.pivot.rotation.z = -1.5;
        this.armR.pivot.rotation.z = 1.5;
        break;
    }
  }

  dispose(): void {
    const mats = new Set<Material>(this.materials);
    const geos = new Set<import('three').BufferGeometry>();
    const visit = (o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry !== unitBox && mesh.geometry !== unitSphere && mesh.geometry !== unitCyl) geos.add(mesh.geometry);
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => mats.add(x));
      else mats.add(m);
    };
    this.root.traverse(visit);
    this.pickaxe.traverse(visit);
    for (const w of this.weaponCache.values()) w.traverse(visit);
    visit(this.consumable);
    visit(this.buildTool);
    for (const m of mats) m.dispose();
    for (const g of geos) g.dispose();
    this.root.removeFromParent();
  }
}

export function emoteAnim(id: string): string {
  return ((cosmetic(id)?.look as EmoteLook | undefined)?.anim) ?? 'wave';
}
