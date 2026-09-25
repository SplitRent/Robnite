import { AdditiveBlending, BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, CanvasTexture, SRGBColorSpace } from 'three';
import type { GroundItem } from '../game/WorldState';
import type { PracticeTarget } from '../weapons/CombatSystem';
import { RARITY_INFO, itemRarity, type ItemStack } from '../inventory/items';
import { buildWeaponMesh } from './CharacterModel';
import { glowTexture } from './textures';

const AMMO_COLOR = { light: 0x9ed0ff, medium: 0x7cd67c, shells: 0xff8a4a, heavy: 0xd6d6d6 };
const MAT_COLOR = { wood: 0xb98552, stone: 0x9aa0a6, metal: 0x8da2b8 };

function targetTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const rings = ['#ffffff', '#e8434b', '#ffffff', '#e8434b', '#ffffff'];
  rings.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(64, 64, 64 - i * 12, 0, Math.PI * 2);
    ctx.fill();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Floating ground loot with rarity glow, plus training targets. */
export class LootView {
  readonly group = new Group();
  private meshes = new Map<number, Group>();
  private targetMeshes = new Map<number, Mesh>();
  private glowGeo = new PlaneGeometry(1, 1);
  private beamGeo = new CylinderGeometry(0.08, 0.08, 6, 6, 1, true);
  private boxGeo = new BoxGeometry(1, 1, 1);
  private cylGeo = new CylinderGeometry(0.5, 0.5, 1, 10);
  private targetGeo = new SphereGeometry(0.55, 20, 14);
  private targetMat = new MeshStandardMaterial({ map: targetTexture(), roughness: 0.5, emissive: 0x220000 });
  private materials: (MeshBasicMaterial | MeshStandardMaterial)[] = [this.targetMat];

  private makeItemMesh(item: ItemStack): Group {
    const g = new Group();
    const rarity = RARITY_INFO[itemRarity(item)];
    let body: Group | Mesh;
    if (item.kind === 'weapon') {
      body = buildWeaponMesh(item.id, { color: 0x2d3238, color2: parseInt(rarity.color.slice(1), 16), emissive: rarity.tier >= 3 });
      body.rotation.y = Math.PI / 2;
      body.scale.setScalar(1.2);
    } else if (item.kind === 'consumable') {
      const color = item.id === 'patch_kit' ? 0xe8434b : 0x3f9dff;
      const m = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 });
      body = new Mesh(item.id === 'patch_kit' ? this.boxGeo : this.cylGeo, m);
      body.scale.set(item.id === 'patch_kit' ? 0.45 : 0.28, item.id === 'shield_canister' ? 0.55 : 0.32, item.id === 'patch_kit' ? 0.32 : 0.28);
    } else if (item.kind === 'ammo') {
      const m = new MeshStandardMaterial({ color: AMMO_COLOR[item.ammo], roughness: 0.6 });
      body = new Mesh(this.boxGeo, m);
      body.scale.set(0.4, 0.22, 0.28);
    } else {
      const m = new MeshStandardMaterial({ color: MAT_COLOR[item.material], roughness: 0.8 });
      body = new Mesh(this.boxGeo, m);
      body.scale.set(0.45, 0.3, 0.45);
    }
    body.position.y = 0.35;
    g.add(body);
    g.userData.body = body;
    const glowMat = new MeshBasicMaterial({ map: glowTexture(), color: rarity.color, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending });
    const glow = new Mesh(this.glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    glow.scale.setScalar(item.kind === 'weapon' ? 1.6 : 1);
    g.add(glow);
    if (item.kind === 'weapon' && rarity.tier >= 2) {
      const beamMat = new MeshBasicMaterial({ color: rarity.color, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
      const beam = new Mesh(this.beamGeo, beamMat);
      beam.position.y = 3;
      g.add(beam);
    }
    return g;
  }

  update(items: Map<number, GroundItem>, targets: PracticeTarget[], time: number): void {
    for (const [id, g] of this.meshes) {
      if (!items.has(id)) {
        g.removeFromParent();
        g.traverse((o) => {
          const m = (o as Mesh).material as MeshBasicMaterial | undefined;
          if ((o as Mesh).isMesh && m) m.dispose();
        });
        this.meshes.delete(id);
      }
    }
    for (const it of items.values()) {
      let g = this.meshes.get(it.id);
      if (!g) {
        g = this.makeItemMesh(it.item);
        this.meshes.set(it.id, g);
        this.group.add(g);
      }
      g.position.copy(it.pos);
      const body = g.userData.body as Group;
      body.rotation.y = time * 1.2 + it.id;
      body.position.y = 0.35 + Math.sin(time * 2 + it.id) * 0.06;
    }
    for (const t of targets) {
      let m = this.targetMeshes.get(t.id);
      if (!m) {
        m = new Mesh(this.targetGeo, this.targetMat);
        m.castShadow = true;
        this.targetMeshes.set(t.id, m);
        this.group.add(m);
      }
      m.visible = t.alive;
      m.position.copy(t.pos);
      m.rotation.y = Math.PI;
      const pop = Math.min(1, (time - t.hitAt) * 4);
      m.scale.setScalar(t.alive ? 1 : pop);
    }
  }

  dispose(): void {
    for (const m of this.materials) m.dispose();
    for (const g of this.meshes.values()) g.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).material as MeshBasicMaterial).dispose() : undefined));
    this.glowGeo.dispose();
    this.beamGeo.dispose();
    this.boxGeo.dispose();
    this.cylGeo.dispose();
    this.targetGeo.dispose();
    this.targetMat.map?.dispose();
    this.group.removeFromParent();
  }
}
