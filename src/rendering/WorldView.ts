import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SphereGeometry,
  Vector3,
  AdditiveBlending,
  type Material,
} from 'three';
import { ValueNoise2D } from '../core/rng';
import { distToSegment } from '../map/builder';
import type { MapData, Region, ResourceKind } from '../map/mapTypes';
import type { WorldState } from '../game/WorldState';
import { boxGeometry, ensureColor, mergeAll, transformed } from './geometry';
import { MaterialLibrary } from './materials';
import { glowTexture, signTexture } from './textures';

const CHUNK = 64;

export interface WorldViewOptions {
  lowQuality: boolean;
  ambientOcclusion: boolean;
  shadows: boolean;
  pointLights: number;
}

/**
 * Renders the static map: terrain, merged static geometry (chunked for
 * frustum culling), instanced resources, doors, chests, signs and water.
 */
export class WorldView {
  readonly group = new Group();
  readonly mats: MaterialLibrary;
  private resourceMeshes = new Map<ResourceKind, InstancedMesh[]>();
  private resourceIndex: { kind: ResourceKind; index: number }[] = [];
  private resourceMatrices: Matrix4[] = [];
  private wobbling = new Set<number>();
  private doorPivots: Group[] = [];
  private chestLids: { lid: Object3D; glow: Mesh; opened: boolean }[] = [];
  private lightPool: PointLight[] = [];
  private water: Mesh | null = null;
  private barrierMesh: Mesh | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(readonly state: WorldState, readonly opts: WorldViewOptions) {
    this.mats = new MaterialLibrary(opts.lowQuality);
    const map = state.map;
    this.buildTerrain(map);
    this.buildStatic(map);
    this.buildRoofs(map);
    this.buildResources(map);
    this.buildDoors();
    this.buildChests();
    this.buildSigns(map);
    this.buildWater(map);
    for (let i = 0; i < opts.pointLights; i++) {
      const l = new PointLight(0xffffff, 0, 10, 2);
      this.lightPool.push(l);
      this.group.add(l);
    }
  }

  // ------------------------------------------------------------- terrain

  private buildTerrain(map: MapData): void {
    const hf = map.terrain;
    const cols = hf.cols;
    const rows = hf.rows;
    const noise = new ValueNoise2D(`${map.id}-grass`);
    const pos = new Float32Array(cols * rows * 3);
    const col = new Float32Array(cols * rows * 3);
    const uv = new Float32Array(cols * rows * 2);
    const pal = map.palette;
    const cGrass = new Color(pal.grass);
    const cGrass2 = new Color(pal.grass2);
    const cDirt = new Color(pal.dirt);
    const cRock = new Color(pal.rock);
    const cSand = new Color(pal.sand);
    const cRoad = new Color(pal.road);
    const cConcrete = new Color(0x9c9c96);
    const cGravel = new Color(0x9a8f7e);
    const tmp = new Color();
    const n = new Vector3();
    const regionWeight = (r: Region, x: number, z: number): number => {
      let d: number;
      if (r.points) {
        d = Infinity;
        for (let i = 0; i < r.points.length - 1; i++) d = Math.min(d, distToSegment(x, z, r.points[i][0], r.points[i][1], r.points[i + 1][0], r.points[i + 1][1]));
      } else d = Math.hypot(x - (r.cx ?? 0), z - (r.cz ?? 0));
      const edge = r.points ? 1.2 : 6;
      return Math.max(0, Math.min(1, (r.radius + edge - d) / (edge * 2)));
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const x = hf.originX + c * hf.spacing;
        const z = hf.originZ + r * hf.spacing;
        const h = hf.heights[i];
        pos[i * 3] = x;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = z;
        uv[i * 2] = x * 0.12;
        uv[i * 2 + 1] = z * 0.12;
        hf.normalAt(x, z, n);
        const g = noise.fbm(x / 25, z / 25, 3) * 0.5 + 0.5;
        tmp.copy(cGrass).lerp(cGrass2, g);
        const slope = 1 - n.y;
        if (slope > 0.18) tmp.lerp(cDirt, Math.min(1, (slope - 0.18) * 4));
        if (slope > 0.35) tmp.lerp(cRock, Math.min(1, (slope - 0.35) * 3));
        for (const reg of map.regions) {
          const w = regionWeight(reg, x, z);
          if (w <= 0) continue;
          const target = reg.kind === 'road' ? cRoad : reg.kind === 'sand' ? cSand : reg.kind === 'concrete' ? cConcrete : reg.kind === 'gravel' ? cGravel : cDirt;
          tmp.lerp(target, w * (reg.kind === 'road' ? 0.92 : 0.8));
        }
        if (map.waterLevel !== null && map.water && Math.hypot(x - map.water.x, z - map.water.z) < map.water.radius && h < map.waterLevel + 0.6) tmp.lerp(cSand, Math.min(1, (map.waterLevel + 0.6 - h) * 0.8));
        if (h > 34) tmp.lerp(cRock, Math.min(0.7, (h - 34) / 20));
        // Cheap baked cavity darkening from curvature.
        const curv = (hf.heightAt(x - 3, z) + hf.heightAt(x + 3, z) + hf.heightAt(x, z - 3) + hf.heightAt(x, z + 3)) / 4 - h;
        const ao = this.opts.ambientOcclusion ? Math.max(0.78, Math.min(1.06, 1 - curv * 0.06)) : 1;
        col[i * 3] = tmp.r * ao;
        col[i * 3 + 1] = tmp.g * ao;
        col[i * 3 + 2] = tmp.b * ao;
      }
    }
    // Chunked index buffers for culling.
    const chunkCells = Math.round(CHUNK / hf.spacing);
    for (let r0 = 0; r0 < rows - 1; r0 += chunkCells) {
      for (let c0 = 0; c0 < cols - 1; c0 += chunkCells) {
        const r1 = Math.min(rows - 1, r0 + chunkCells);
        const c1 = Math.min(cols - 1, c0 + chunkCells);
        const w = c1 - c0 + 1;
        const hgt = r1 - r0 + 1;
        const P = new Float32Array(w * hgt * 3);
        const Cc = new Float32Array(w * hgt * 3);
        const U = new Float32Array(w * hgt * 2);
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const src = r * cols + c;
            const dst = (r - r0) * w + (c - c0);
            P.set(pos.subarray(src * 3, src * 3 + 3), dst * 3);
            Cc.set(col.subarray(src * 3, src * 3 + 3), dst * 3);
            U.set(uv.subarray(src * 2, src * 2 + 2), dst * 2);
          }
        }
        const idx: number[] = [];
        for (let r = 0; r < hgt - 1; r++) {
          for (let c = 0; c < w - 1; c++) {
            const a = r * w + c;
            const b = a + 1;
            const d = a + w;
            const e = d + 1;
            idx.push(a, d, b, b, d, e);
          }
        }
        const geo = new BufferGeometry();
        geo.setAttribute('position', new Float32BufferAttribute(P, 3));
        geo.setAttribute('color', new Float32BufferAttribute(Cc, 3));
        geo.setAttribute('uv', new Float32BufferAttribute(U, 2));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        // Fix seams: use analytic normals from the heightfield.
        const normals = geo.getAttribute('normal');
        for (let i = 0; i < normals.count; i++) {
          hf.normalAt(P[i * 3], P[i * 3 + 2], n);
          normals.setXYZ(i, n.x, n.y, n.z);
        }
        const mesh = new Mesh(geo, this.mats.terrain);
        mesh.receiveShadow = this.opts.shadows;
        this.group.add(mesh);
        this.disposables.push(geo);
      }
    }
  }

  // ------------------------------------------------------------- static geometry

  private buildStatic(map: MapData): void {
    const chunks = new Map<string, { solid: BufferGeometry[]; emissive: BufferGeometry[]; glass: BufferGeometry[] }>();
    const chunkOf = (x: number, z: number) => {
      const key = `${Math.floor(x / CHUNK)}:${Math.floor(z / CHUNK)}`;
      let ch = chunks.get(key);
      if (!ch) {
        ch = { solid: [], emissive: [], glass: [] };
        chunks.set(key, ch);
      }
      return ch;
    };
    const ao = this.opts.ambientOcclusion ? 0.35 : 0;
    for (const b of map.boxes) {
      if (b.color < 0) continue;
      const cx = (b.min[0] + b.max[0]) / 2;
      const cz = (b.min[2] + b.max[2]) / 2;
      const ch = chunkOf(cx, cz);
      const g = boxGeometry(b.min, b.max, b.color, 0.25, ao);
      if (b.glass) ch.glass.push(g);
      else if (b.emissive) ch.emissive.push(g);
      else ch.solid.push(g);
    }
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const templates = {
      box: new BoxGeometry(1, 1, 1),
      cyl: new CylinderGeometry(1, 1, 1, 12, 1),
      cone: new ConeGeometry(1, 1, 12, 1),
      sphere: new SphereGeometry(1, 12, 8),
    };
    for (const d of map.decos) {
      const tpl = d.segments && d.shape !== 'box' && d.shape !== 'sphere'
        ? d.shape === 'cyl' ? new CylinderGeometry(1, 1, 1, d.segments, 1) : new ConeGeometry(1, 1, d.segments, 1)
        : templates[d.shape];
      e.set(d.rot[0], d.rot[1], d.rot[2]);
      q.setFromEuler(e);
      const scale = d.shape === 'box' ? new Vector3(d.size[0], d.size[1], d.size[2]) : d.shape === 'sphere' ? new Vector3(d.size[0], d.size[1], d.size[2]) : new Vector3(d.size[0], d.size[1], d.size[2]);
      m.compose(new Vector3(d.pos[0], d.pos[1], d.pos[2]), q, scale);
      const g = ensureColor(transformed(tpl, m), d.color);
      const ch = chunkOf(d.pos[0], d.pos[2]);
      if (d.emissive) ch.emissive.push(g);
      else ch.solid.push(g);
    }
    for (const ch of chunks.values()) {
      const solid = mergeAll(ch.solid);
      if (solid) {
        const mesh = new Mesh(solid, this.mats.world);
        mesh.castShadow = this.opts.shadows;
        mesh.receiveShadow = this.opts.shadows;
        this.group.add(mesh);
        this.disposables.push(solid);
      }
      const em = mergeAll(ch.emissive);
      if (em) {
        this.group.add(new Mesh(em, this.mats.worldEmissive));
        this.disposables.push(em);
      }
      const gl = mergeAll(ch.glass);
      if (gl) {
        const mesh = new Mesh(gl, this.mats.glass);
        mesh.renderOrder = 2;
        this.group.add(mesh);
        this.disposables.push(gl);
      }
    }
    for (const t of Object.values(templates)) t.dispose();
    // Spawn barriers: separate mesh so they can be hidden when lowered.
    const bar = mergeAll(map.barriers.map((b) => boxGeometry(b.min, b.max, b.color)));
    if (bar) {
      this.barrierMesh = new Mesh(bar, this.mats.track(new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.18, depthWrite: false })));
      this.barrierMesh.renderOrder = 2;
      this.group.add(this.barrierMesh);
      this.disposables.push(bar);
    }
  }

  private buildRoofs(map: MapData): void {
    const list: BufferGeometry[] = [];
    for (const r of map.roofs) {
      const P: number[] = [];
      const tri = (a: number[], b: number[], c: number[]) => P.push(...a, ...b, ...c);
      const { x0, x1, z0, z1, y, peak } = r;
      const top = y + peak;
      if (r.ridge === 'x') {
        const zm = (z0 + z1) / 2;
        tri([x0, y, z1], [x1, y, z1], [x1, top, zm]);
        tri([x0, y, z1], [x1, top, zm], [x0, top, zm]);
        tri([x1, y, z0], [x0, y, z0], [x0, top, zm]);
        tri([x1, y, z0], [x0, top, zm], [x1, top, zm]);
        tri([x0, y, z0], [x0, y, z1], [x0, top, zm]);
        tri([x1, y, z1], [x1, y, z0], [x1, top, zm]);
      } else {
        const xm = (x0 + x1) / 2;
        tri([x1, y, z1], [x1, y, z0], [xm, top, z0]);
        tri([x1, y, z1], [xm, top, z0], [xm, top, z1]);
        tri([x0, y, z0], [x0, y, z1], [xm, top, z1]);
        tri([x0, y, z0], [xm, top, z1], [xm, top, z0]);
        tri([x0, y, z1], [x1, y, z1], [xm, top, z1]);
        tri([x1, y, z0], [x0, y, z0], [xm, top, z0]);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(P, 3));
      const U: number[] = [];
      for (let i = 0; i < P.length; i += 3) U.push((P[i] + P[i + 1]) * 0.25, (P[i + 2] + P[i + 1]) * 0.25);
      g.setAttribute('uv', new Float32BufferAttribute(U, 2));
      g.computeVertexNormals();
      list.push(ensureColor(g, r.color));
    }
    const merged = mergeAll(list);
    if (merged) {
      const mesh = new Mesh(merged, this.mats.roof);
      mesh.castShadow = this.opts.shadows;
      mesh.receiveShadow = this.opts.shadows;
      this.group.add(mesh);
      this.disposables.push(merged);
    }
  }

  // ------------------------------------------------------------- resources

  private resourceParts(kind: ResourceKind): { geo: BufferGeometry; material: Material; tint: boolean }[] {
    const mats = this.mats;
    const col = (g: BufferGeometry, c: number) => ensureColor(g, c);
    switch (kind) {
      case 'pine': {
        const trunk = col(transformed(new CylinderGeometry(0.22, 0.32, 3, 7), new Matrix4().makeTranslation(0, 1.5, 0)), 0x6b4a2e);
        const cones = [
          transformed(new ConeGeometry(2.2, 3.2, 8), new Matrix4().makeTranslation(0, 3.6, 0)),
          transformed(new ConeGeometry(1.7, 2.8, 8), new Matrix4().makeTranslation(0, 5.2, 0)),
          transformed(new ConeGeometry(1.1, 2.4, 8), new Matrix4().makeTranslation(0, 6.7, 0)),
        ].map((g) => col(g, 0xffffff));
        return [
          { geo: trunk, material: mats.plain, tint: false },
          { geo: mergeAll(cones)!, material: mats.foliage, tint: true },
        ];
      }
      case 'oak': {
        const trunk = col(transformed(new CylinderGeometry(0.25, 0.38, 3.4, 7), new Matrix4().makeTranslation(0, 1.7, 0)), 0x5e4027);
        const blobs = [
          transformed(new IcosahedronGeometry(2.1, 0), new Matrix4().makeTranslation(0, 4.4, 0)),
          transformed(new IcosahedronGeometry(1.5, 0), new Matrix4().makeTranslation(1.3, 3.9, 0.4)),
          transformed(new IcosahedronGeometry(1.4, 0), new Matrix4().makeTranslation(-1.1, 4.0, -0.6)),
          transformed(new IcosahedronGeometry(1.2, 0), new Matrix4().makeTranslation(0.2, 5.6, 0.3)),
        ].map((g) => col(g, 0xffffff));
        return [
          { geo: trunk, material: mats.plain, tint: false },
          { geo: mergeAll(blobs)!, material: mats.foliage, tint: true },
        ];
      }
      case 'rock': {
        const g = new DodecahedronGeometry(1.2, 0);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          p.setY(i, y * 0.75 + 0.35);
          p.setX(i, p.getX(i) * (1 + Math.sin(i * 1.7) * 0.12));
          p.setZ(i, p.getZ(i) * (1 + Math.cos(i * 2.3) * 0.12));
        }
        g.computeVertexNormals();
        return [{ geo: col(g, 0xffffff), material: mats.foliage, tint: true }];
      }
      case 'crate': {
        const body = boxGeometry([-0.6, 0, -0.6], [0.6, 1.2, 0.6], 0xa8783f, 0.8);
        const bands = [
          boxGeometry([-0.62, 0.1, -0.62], [0.62, 0.22, 0.62], 0x6b4a2a),
          boxGeometry([-0.62, 0.98, -0.62], [0.62, 1.1, 0.62], 0x6b4a2a),
        ];
        return [{ geo: mergeAll([body, ...bands])!, material: mats.world, tint: false }];
      }
      case 'barrel': {
        const b = col(transformed(new CylinderGeometry(0.4, 0.4, 1.2, 12), new Matrix4().makeTranslation(0, 0.6, 0)), 0xffffff);
        const rings = [0.25, 0.95].map((y) => col(transformed(new CylinderGeometry(0.42, 0.42, 0.08, 12), new Matrix4().makeTranslation(0, y, 0)), 0x333333));
        return [
          { geo: b, material: mats.plain, tint: true },
          { geo: mergeAll(rings)!, material: mats.plain, tint: false },
        ];
      }
      case 'car': {
        const body = mergeAll([
          boxGeometry([-0.95, 0.35, -2.1], [0.95, 1.0, 2.1], 0xffffff, 0.5),
          boxGeometry([-0.85, 1.0, -1.1], [0.85, 1.55, 0.9], 0xffffff, 0.5),
        ])!;
        const details = mergeAll([
          boxGeometry([-0.8, 1.02, -1.12], [0.8, 1.5, -1.05], 0x1c2a36),
          boxGeometry([-0.8, 1.02, 0.86], [0.8, 1.5, 0.93], 0x1c2a36),
          boxGeometry([-0.88, 1.05, -1.0], [-0.84, 1.48, 0.8], 0x1c2a36),
          boxGeometry([0.84, 1.05, -1.0], [0.88, 1.48, 0.8], 0x1c2a36),
          ...[[-1.35], [1.35]].flatMap(([z]) => [
            ensureColor(transformed(new CylinderGeometry(0.36, 0.36, 0.3, 10), new Matrix4().makeRotationZ(Math.PI / 2).setPosition(-0.9, 0.36, z)), 0x1a1a1a),
            ensureColor(transformed(new CylinderGeometry(0.36, 0.36, 0.3, 10), new Matrix4().makeRotationZ(Math.PI / 2).setPosition(0.9, 0.36, z)), 0x1a1a1a),
          ]),
          boxGeometry([-0.7, 0.55, 2.1], [-0.35, 0.75, 2.14], 0xfff2c0),
          boxGeometry([0.35, 0.55, 2.1], [0.7, 0.75, 2.14], 0xfff2c0),
        ])!;
        return [
          { geo: body, material: mats.world, tint: true },
          { geo: details, material: mats.plain, tint: false },
        ];
      }
    }
  }

  private buildResources(map: MapData): void {
    const byKind = new Map<ResourceKind, number[]>();
    map.resources.forEach((r, i) => {
      const list = byKind.get(r.kind) ?? [];
      list.push(i);
      byKind.set(r.kind, list);
    });
    const m = new Matrix4();
    const q = new Quaternion();
    const color = new Color();
    for (const [kind, ids] of byKind) {
      const parts = this.resourceParts(kind);
      const meshes: InstancedMesh[] = [];
      for (const part of parts) {
        const im = new InstancedMesh(part.geo, part.material, ids.length);
        im.castShadow = this.opts.shadows;
        im.receiveShadow = this.opts.shadows && (kind === 'rock' || kind === 'car' || kind === 'crate');
        meshes.push(im);
        this.group.add(im);
        this.disposables.push(part.geo);
      }
      ids.forEach((id, index) => {
        const r = map.resources[id];
        q.setFromAxisAngle(new Vector3(0, 1, 0), r.rotY);
        const s = r.scale;
        m.compose(new Vector3(r.x, r.y, r.z), q, new Vector3(s, s * (kind === 'rock' ? 0.8 + (id % 5) * 0.08 : 1), s));
        this.resourceIndex[id] = { kind, index };
        this.resourceMatrices[id] = m.clone();
        parts.forEach((part, pi) => {
          meshes[pi].setMatrixAt(index, m);
          if (part.tint) {
            if (kind === 'pine') color.setHSL(0.33 + ((id * 37) % 10) / 200, 0.45, 0.24 + ((id * 13) % 10) / 120);
            else if (kind === 'oak') color.setHSL(0.24 + ((id * 17) % 10) / 150, 0.5, 0.33 + ((id * 7) % 10) / 100);
            else if (kind === 'rock') color.setHSL(0.1, 0.05, 0.45 + ((id * 11) % 10) / 60);
            else if (kind === 'barrel') color.set(id % 3 === 0 ? 0x2f6fa8 : id % 3 === 1 ? 0xc9443a : 0x3f8a52);
            else color.set(r.color ?? 0x888888);
            meshes[pi].setColorAt(index, color);
          }
        });
      });
      for (const im of meshes) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.computeBoundingSphere();
      }
      this.resourceMeshes.set(kind, meshes);
    }
  }

  // ------------------------------------------------------------- doors / chests / signs / water

  private buildDoors(): void {
    const mat = this.mats.track(new MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 }));
    const knob = this.mats.track(new MeshStandardMaterial({ color: 0xd8b64a, metalness: 0.6, roughness: 0.3 }));
    for (const d of this.state.doors) {
      const s = d.spec;
      const pivot = new Group();
      const w = s.width;
      const geo = new BoxGeometry(w, s.height, 0.1);
      this.disposables.push(geo);
      const door = new Mesh(geo, s.color === 0x2e3a46 ? this.mats.track(new MeshStandardMaterial({ color: 0x2e3a46, roughness: 0.4, metalness: 0.5 })) : mat);
      door.position.set(w / 2, s.height / 2, 0);
      door.castShadow = this.opts.shadows;
      const k = new Mesh(new SphereGeometry(0.06, 8, 6), knob);
      k.position.set(w - 0.2, s.height * 0.45, 0.08);
      door.add(k);
      pivot.add(door);
      if (s.axis === 0) pivot.position.set(s.x - w / 2, s.y, s.z);
      else {
        pivot.position.set(s.x, s.y, s.z + w / 2);
        pivot.rotation.y = Math.PI / 2;
      }
      pivot.userData.baseRot = pivot.rotation.y;
      pivot.userData.open = 0;
      this.doorPivots.push(pivot);
      this.group.add(pivot);
    }
  }

  private buildChests(): void {
    const wood = this.mats.track(new MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.7 }));
    const trim = this.mats.track(new MeshStandardMaterial({ color: 0xf2c14e, metalness: 0.7, roughness: 0.35, emissive: 0x3a2a05 }));
    const metal = this.mats.track(new MeshStandardMaterial({ color: 0x3b73c4, metalness: 0.5, roughness: 0.4 }));
    const glowMat = this.mats.track(new MeshBasicMaterial({ map: glowTexture(), color: 0xffd36b, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    const baseGeo = new BoxGeometry(1.1, 0.55, 0.7);
    const lidGeo = new BoxGeometry(1.1, 0.25, 0.7);
    const bandGeo = new BoxGeometry(1.14, 0.08, 0.74);
    const glowGeo = new PlaneGeometry(1.8, 1.8);
    this.disposables.push(baseGeo, lidGeo, bandGeo, glowGeo);
    for (const ch of this.state.chests) {
      const s = ch.spec;
      const g = new Group();
      const supply = s.kind === 'supply';
      const base = new Mesh(baseGeo, supply ? metal : wood);
      base.position.y = 0.275;
      base.castShadow = this.opts.shadows;
      const band = new Mesh(bandGeo, trim);
      band.position.y = 0.45;
      const lidPivot = new Group();
      lidPivot.position.set(0, 0.55, -0.35);
      const lid = new Mesh(lidGeo, supply ? metal : wood);
      lid.position.set(0, 0.125, 0.35);
      const lidBand = new Mesh(bandGeo, trim);
      lidBand.position.set(0, 0.13, 0.35);
      lidPivot.add(lid, lidBand);
      const glow = new Mesh(glowGeo, glowMat);
      glow.position.y = 0.7;
      g.add(base, band, lidPivot, glow);
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.rotY;
      this.group.add(g);
      this.chestLids.push({ lid: lidPivot, glow, opened: false });
    }
  }

  private buildSigns(map: MapData): void {
    for (const s of map.signs) {
      const tex = signTexture(s.text, s.color ?? '#ffffff', s.color ? 'rgba(0,0,0,0)' : 'rgba(22,30,40,0.92)');
      const mat = this.mats.track(new MeshBasicMaterial({ map: tex, transparent: true, side: DoubleSide, toneMapped: false }));
      const h = s.width * (96 / 512);
      const geo = new PlaneGeometry(s.width, h);
      this.disposables.push(geo);
      const mesh = new Mesh(geo, mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.rotY;
      this.group.add(mesh);
    }
  }

  private buildWater(map: MapData): void {
    if (map.waterLevel === null || !map.water) return;
    const geo = new CircleGeometry(map.water.radius, 64);
    geo.rotateX(-Math.PI / 2);
    geo.translate(map.water.x, 0, map.water.z);
    this.disposables.push(geo);
    const mat = this.mats.track(new MeshStandardMaterial({ color: 0x2f86b8, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.2 }));
    this.water = new Mesh(geo, mat);
    this.water.position.y = map.waterLevel;
    this.water.receiveShadow = this.opts.shadows;
    this.group.add(this.water);
  }

  // ------------------------------------------------------------- per frame

  update(time: number, focus: Vector3): void {
    // Resource destruction + hit wobble
    const tmp = new Matrix4();
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (const node of this.state.resources) {
      const info = this.resourceIndex[node.id];
      if (!info) continue;
      const meshes = this.resourceMeshes.get(info.kind)!;
      const hitRecently = time - node.hitAt < 0.25;
      if (!node.alive) {
        if (!this.wobbling.has(-node.id - 1)) {
          for (const im of meshes) {
            im.setMatrixAt(info.index, zero);
            im.instanceMatrix.needsUpdate = true;
          }
          this.wobbling.add(-node.id - 1);
        }
        continue;
      }
      if (hitRecently || this.wobbling.has(node.id)) {
        const base = this.resourceMatrices[node.id];
        if (hitRecently) {
          const k = 1 - (time - node.hitAt) / 0.25;
          const s = 1 + Math.sin(k * 20) * 0.04 * k;
          tmp.copy(base).multiply(new Matrix4().makeScale(s, 1 / s, s));
          this.wobbling.add(node.id);
        } else {
          tmp.copy(base);
          this.wobbling.delete(node.id);
        }
        for (const im of meshes) {
          im.setMatrixAt(info.index, tmp);
          im.instanceMatrix.needsUpdate = true;
        }
      }
    }
    // Doors
    this.state.doors.forEach((d, i) => {
      const p = this.doorPivots[i];
      const target = d.open ? 1 : 0;
      const cur = p.userData.open as number;
      if (Math.abs(cur - target) > 0.001) {
        const next = cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), 0.12);
        p.userData.open = next;
        p.rotation.y = (p.userData.baseRot as number) - next * (Math.PI / 2) * 0.95;
      }
    });
    // Chests
    this.state.chests.forEach((c, i) => {
      const v = this.chestLids[i];
      if (c.opened && !v.opened) v.opened = true;
      if (v.opened) {
        v.lid.rotation.x = Math.max(v.lid.rotation.x - 0.12, -1.9);
        v.glow.visible = false;
      } else {
        v.glow.lookAt(focus.x, v.glow.getWorldPosition(new Vector3()).y, focus.z);
        const s = 0.85 + Math.sin(time * 3 + i) * 0.15;
        v.glow.scale.set(s, s, s);
      }
    });
    // Point light pool follows the closest light sources.
    if (this.lightPool.length && Math.floor(time * 2) !== Math.floor((time - 0.017) * 2)) {
      const lights = [...this.state.map.lights].sort((a, b) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2));
      this.lightPool.forEach((l, i) => {
        const s = lights[i];
        if (!s) {
          l.intensity = 0;
          return;
        }
        l.position.set(s.x, s.y, s.z);
        l.color.setHex(s.color);
        l.intensity = s.intensity * 4;
        l.distance = s.distance;
      });
    }
    if (this.barrierMesh) this.barrierMesh.visible = this.state.barrierColliders.some((c) => c.enabled);
    if (this.water) {
      const m = this.water.material as MeshStandardMaterial;
      m.opacity = 0.76 + Math.sin(time * 0.8) * 0.03;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const meshes of this.resourceMeshes.values()) for (const im of meshes) im.dispose();
    this.mats.dispose();
    this.group.removeFromParent();
  }
}
