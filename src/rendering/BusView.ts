import { Group, Mesh, MeshStandardMaterial, BoxGeometry, CylinderGeometry, SphereGeometry, MeshBasicMaterial, AdditiveBlending, PlaneGeometry } from 'three';
import { glowTexture } from './textures';

/** The "Skybarge" drop ship that carries players across the map. */
export class BusView {
  readonly group = new Group();
  private props: Mesh[] = [];
  private mats: (MeshStandardMaterial | MeshBasicMaterial)[] = [];
  private geos = [new BoxGeometry(1, 1, 1), new CylinderGeometry(1, 1, 1, 16), new SphereGeometry(1, 16, 10), new PlaneGeometry(1, 1)];

  constructor() {
    const [boxG, cylG, sphG, planeG] = this.geos;
    const hull = this.mat(new MeshStandardMaterial({ color: 0x2b3a4a, metalness: 0.4, roughness: 0.45 }));
    const trim = this.mat(new MeshStandardMaterial({ color: 0xf2b634, metalness: 0.3, roughness: 0.4 }));
    const glass = this.mat(new MeshStandardMaterial({ color: 0x5ee7ff, emissive: 0x2a9bb0, roughness: 0.1 }));
    const add = (geo: typeof boxG, mat: MeshStandardMaterial, s: [number, number, number], p: [number, number, number], r: [number, number, number] = [0, 0, 0]) => {
      const m = new Mesh(geo, mat);
      m.scale.set(...s);
      m.position.set(...p);
      m.rotation.set(...r);
      this.group.add(m);
      return m;
    };
    const body = add(sphG, hull, [3.2, 2.2, 9], [0, 0, 0]);
    body.castShadow = true;
    add(boxG, trim, [6.6, 0.3, 12], [0, -0.3, 0]);
    add(sphG, glass, [1.6, 0.9, 1.8], [0, 0.7, -7.2]);
    for (const x of [-5, 5]) {
      add(boxG, hull, [4, 0.3, 2.4], [x, 0.2, 1]);
      add(cylG, trim, [0.9, 1.6, 0.9], [x * 1.25, 0.4, 1], [Math.PI / 2, 0, 0]);
      const prop = add(boxG, hull, [0.2, 3.2, 0.3], [x * 1.25, 0.4, -0.1]);
      this.props.push(prop);
    }
    add(boxG, trim, [0.3, 2.4, 2.4], [0, 2, 7.6]);
    const glowMat = this.mat(new MeshBasicMaterial({ map: glowTexture(), color: 0x5ee7ff, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    for (const x of [-6.25, 6.25]) {
      const g = new Mesh(planeG, glowMat);
      g.scale.setScalar(3);
      g.position.set(x, 0.4, 2);
      g.rotation.x = Math.PI / 2;
      this.group.add(g);
    }
    this.group.visible = false;
  }

  private mat<T extends MeshStandardMaterial | MeshBasicMaterial>(m: T): T {
    this.mats.push(m);
    return m;
  }

  update(time: number): void {
    for (const p of this.props) p.rotation.z = time * 30;
    this.group.position.y += Math.sin(time * 1.5) * 0.004;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    this.group.removeFromParent();
  }
}
