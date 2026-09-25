import { DoubleSide, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, type Material, type Texture } from 'three';
import { detailTexture } from './textures';

/** Shared materials (reused across meshes to minimise shader programs). */
export class MaterialLibrary {
  readonly world: MeshStandardMaterial | MeshLambertMaterial;
  readonly worldEmissive: MeshBasicMaterial;
  readonly glass: MeshStandardMaterial;
  readonly roof: MeshStandardMaterial | MeshLambertMaterial;
  readonly terrain: MeshStandardMaterial | MeshLambertMaterial;
  readonly foliage: MeshStandardMaterial | MeshLambertMaterial;
  readonly plain: MeshStandardMaterial | MeshLambertMaterial;
  private all: Material[] = [];

  constructor(readonly lowQuality: boolean) {
    const detail: Texture = detailTexture();
    const make = (opts: { map?: Texture; side?: typeof DoubleSide; roughness?: number; flat?: boolean }) => {
      const base: { vertexColors: boolean; map?: Texture; side?: typeof DoubleSide } = { vertexColors: true };
      if (opts.map) base.map = opts.map;
      if (opts.side !== undefined) base.side = opts.side;
      return lowQuality
        ? new MeshLambertMaterial(base)
        : new MeshStandardMaterial({ ...base, roughness: opts.roughness ?? 0.88, metalness: 0.02, flatShading: !!opts.flat });
    };
    this.world = make({ map: detail });
    this.roof = make({ map: detail, side: DoubleSide });
    this.terrain = make({ map: detail, roughness: 0.95 });
    this.foliage = make({ roughness: 0.9, flat: true });
    this.plain = make({});
    this.worldEmissive = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.glass = new MeshStandardMaterial({ color: 0xa8dcf0, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.3, depthWrite: false });
    this.all.push(this.world, this.roof, this.terrain, this.foliage, this.plain, this.worldEmissive, this.glass);
  }

  track<T extends Material>(m: T): T {
    this.all.push(m);
    return m;
  }

  dispose(): void {
    for (const m of this.all) m.dispose();
  }
}
