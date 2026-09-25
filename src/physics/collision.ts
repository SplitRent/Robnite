import { Vector3 } from 'three';
import type { Heightfield } from './terrain';

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export type ColliderOwner = 'static' | 'build' | 'resource' | 'door' | 'prop' | 'bound';
export type SurfaceMaterial = 'wood' | 'stone' | 'metal' | 'glass' | 'dirt' | 'foliage' | 'concrete';

interface ColliderBase {
  id: number;
  owner: ColliderOwner;
  /** Owning entity id (build piece id, resource id, door id ...). */
  ref: number;
  box: AABB;
  enabled: boolean;
  material: SurfaceMaterial;
  blocksBullets: boolean;
  /** Internal query stamp used for de-duplication. */
  stamp: number;
}

export interface BoxCollider extends ColliderBase {
  kind: 'box';
}

/**
 * A walkable one-sided height surface (ramps, cones, pitched roofs). Returns
 * the surface height at an XZ position, or null where there is no surface.
 */
export interface SurfaceCollider extends ColliderBase {
  kind: 'surface';
  height: (x: number, z: number) => number | null;
}

export type Collider = BoxCollider | SurfaceCollider;

export interface RayHit {
  t: number;
  point: Vector3;
  normal: Vector3;
  collider: Collider | null;
  terrain: boolean;
}

export interface RaycastOptions {
  includeTerrain?: boolean;
  /** Return false to skip a collider. */
  filter?: (c: Collider) => boolean;
  /** Only colliders that stop bullets. */
  bulletsOnly?: boolean;
}

const HASH_CELL = 8;

export function makeAABB(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function aabbOverlap(a: AABB, b: AABB, eps = 0): boolean {
  return (
    a.minX < b.maxX - eps &&
    a.maxX > b.minX + eps &&
    a.minY < b.maxY - eps &&
    a.maxY > b.minY + eps &&
    a.minZ < b.maxZ - eps &&
    a.maxZ > b.minZ + eps
  );
}

/** Slab test. Returns entry distance and writes the entry normal. */
export function rayAABB(o: Vector3, d: Vector3, b: AABB, maxDist: number, outNormal: Vector3): number {
  let tmin = 0;
  let tmax = maxDist;
  let axis = -1;
  let sign = 0;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  const mins = [b.minX, b.minY, b.minZ];
  const maxs = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < mins[i] || os[i] > maxs[i]) return -1;
      continue;
    }
    const inv = 1 / ds[i];
    let t1 = (mins[i] - os[i]) * inv;
    let t2 = (maxs[i] - os[i]) * inv;
    let s = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  outNormal.set(0, 0, 0);
  if (axis === 0) outNormal.x = sign;
  else if (axis === 1) outNormal.y = sign;
  else if (axis === 2) outNormal.z = sign;
  else {
    // Origin inside the box: report the opposite of the ray direction.
    outNormal.set(-d.x, -d.y, -d.z);
  }
  return tmin;
}

const tmpN = new Vector3();

/** March a ray through a surface collider's bounds and bisect the crossing. */
export function raySurface(o: Vector3, d: Vector3, s: SurfaceCollider, maxDist: number, outNormal: Vector3): number {
  const enter = rayAABB(o, d, s.box, maxDist, tmpN);
  if (enter < 0) return -1;
  // Find exit distance.
  const far = rayAABBExit(o, d, s.box, maxDist);
  const step = 0.08;
  let prevT = enter;
  let prevDelta: number | null = surfDelta(o, d, s, enter);
  for (let t = enter + step; t <= far + step; t += step) {
    const tt = Math.min(t, far);
    const delta = surfDelta(o, d, s, tt);
    if (delta !== null && prevDelta !== null && Math.sign(delta) !== Math.sign(prevDelta)) {
      let lo = prevT;
      let hi = tt;
      const startSign = Math.sign(prevDelta);
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) * 0.5;
        const dm = surfDelta(o, d, s, mid);
        if (dm !== null && Math.sign(dm) === startSign) lo = mid;
        else hi = mid;
      }
      const hx = o.x + d.x * hi;
      const hz = o.z + d.z * hi;
      surfaceNormal(s, hx, hz, outNormal);
      if (startSign < 0) outNormal.multiplyScalar(-1);
      return hi;
    }
    prevT = tt;
    prevDelta = delta;
    if (tt >= far) break;
  }
  return -1;
}

function surfDelta(o: Vector3, d: Vector3, s: SurfaceCollider, t: number): number | null {
  const h = s.height(o.x + d.x * t, o.z + d.z * t);
  if (h === null) return null;
  return o.y + d.y * t - h;
}

export function surfaceNormal(s: SurfaceCollider, x: number, z: number, out: Vector3): Vector3 {
  const e = 0.05;
  const h = s.height(x, z) ?? 0;
  const hx = s.height(x + e, z) ?? s.height(x - e, z) ?? h;
  const hz = s.height(x, z + e) ?? s.height(x, z - e) ?? h;
  const sx = s.height(x + e, z) !== null ? 1 : -1;
  const sz = s.height(x, z + e) !== null ? 1 : -1;
  return out.set(-(hx - h) * sx, e, -(hz - h) * sz).normalize();
}

function rayAABBExit(o: Vector3, d: Vector3, b: AABB, maxDist: number): number {
  let tmax = maxDist;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  const mins = [b.minX, b.minY, b.minZ];
  const maxs = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) continue;
    const t1 = (mins[i] - os[i]) / ds[i];
    const t2 = (maxs[i] - os[i]) / ds[i];
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return tmax;
}

/**
 * Spatial-hashed collision world holding static geometry, build pieces,
 * resource nodes and doors plus the terrain heightfield.
 */
export class CollisionWorld {
  private cells = new Map<number, Collider[]>();
  private colliders = new Map<number, Collider>();
  private nextId = 1;
  private stamp = 1;
  /** Hard map bounds (players are clamped inside). */
  bounds: AABB = makeAABB(-1e4, -200, -1e4, 1e4, 1e4, 1e4);

  constructor(public terrain: Heightfield | null) {}

  private key(ix: number, iz: number): number {
    return ((ix + 32768) << 16) | ((iz + 32768) & 0xffff);
  }

  get size(): number {
    return this.colliders.size;
  }

  addBox(box: AABB, owner: ColliderOwner, ref = 0, material: SurfaceMaterial = 'concrete', blocksBullets = true): BoxCollider {
    const c: BoxCollider = { id: this.nextId++, kind: 'box', box, owner, ref, enabled: true, material, blocksBullets, stamp: 0 };
    this.insert(c);
    return c;
  }

  addSurface(
    box: AABB,
    height: (x: number, z: number) => number | null,
    owner: ColliderOwner,
    ref = 0,
    material: SurfaceMaterial = 'wood',
  ): SurfaceCollider {
    const c: SurfaceCollider = { id: this.nextId++, kind: 'surface', box, height, owner, ref, enabled: true, material, blocksBullets: true, stamp: 0 };
    this.insert(c);
    return c;
  }

  private insert(c: Collider): void {
    this.colliders.set(c.id, c);
    const b = c.box;
    const x0 = Math.floor(b.minX / HASH_CELL);
    const x1 = Math.floor(b.maxX / HASH_CELL);
    const z0 = Math.floor(b.minZ / HASH_CELL);
    const z1 = Math.floor(b.maxZ / HASH_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) {
          list = [];
          this.cells.set(k, list);
        }
        list.push(c);
      }
    }
  }

  remove(c: Collider): void {
    if (!this.colliders.delete(c.id)) return;
    const b = c.box;
    const x0 = Math.floor(b.minX / HASH_CELL);
    const x1 = Math.floor(b.maxX / HASH_CELL);
    const z0 = Math.floor(b.minZ / HASH_CELL);
    const z1 = Math.floor(b.maxZ / HASH_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        const i = list.indexOf(c);
        if (i >= 0) {
          list[i] = list[list.length - 1];
          list.pop();
        }
      }
    }
  }

  /** Collect enabled colliders whose bounds overlap the query box. */
  query(box: AABB, out: Collider[] = []): Collider[] {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(box.minX / HASH_CELL);
    const x1 = Math.floor(box.maxX / HASH_CELL);
    const z0 = Math.floor(box.minZ / HASH_CELL);
    const z1 = Math.floor(box.maxZ / HASH_CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const c of list) {
          if (c.stamp === s || !c.enabled) continue;
          c.stamp = s;
          if (aabbOverlap(c.box, box)) out.push(c);
        }
      }
    }
    return out;
  }

  terrainHeight(x: number, z: number): number {
    return this.terrain ? this.terrain.heightAt(x, z) : 0;
  }

  /**
   * Raycast against terrain and colliders using a 2D DDA over the hash grid.
   * `dir` must be normalised.
   */
  raycast(origin: Vector3, dir: Vector3, maxDist: number, opts: RaycastOptions = {}): RayHit | null {
    let bestT = maxDist;
    let best: Collider | null = null;
    let terrainHit = false;
    const bestNormal = new Vector3();
    const n = new Vector3();

    if (opts.includeTerrain !== false) {
      if (this.terrain) {
        const t = this.terrain.raycast(origin, dir, maxDist);
        if (t >= 0 && t < bestT) {
          bestT = t;
          terrainHit = true;
          const px = origin.x + dir.x * t;
          const pz = origin.z + dir.z * t;
          this.terrain.normalAt(px, pz, bestNormal);
        }
      } else if (dir.y < 0) {
        const t = -origin.y / dir.y;
        if (t >= 0 && t < bestT) {
          bestT = t;
          terrainHit = true;
          bestNormal.set(0, 1, 0);
        }
      }
    }

    // 2D DDA traversal over hash cells.
    const s = ++this.stamp;
    let ix = Math.floor(origin.x / HASH_CELL);
    let iz = Math.floor(origin.z / HASH_CELL);
    const stepX = dir.x > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) < 1e-9 ? Infinity : HASH_CELL / Math.abs(dir.x);
    const tDeltaZ = Math.abs(dir.z) < 1e-9 ? Infinity : HASH_CELL / Math.abs(dir.z);
    const nextBoundX = (ix + (stepX > 0 ? 1 : 0)) * HASH_CELL;
    const nextBoundZ = (iz + (stepZ > 0 ? 1 : 0)) * HASH_CELL;
    let tMaxX = Math.abs(dir.x) < 1e-9 ? Infinity : (nextBoundX - origin.x) / dir.x;
    let tMaxZ = Math.abs(dir.z) < 1e-9 ? Infinity : (nextBoundZ - origin.z) / dir.z;
    let tCell = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const list = this.cells.get(this.key(ix, iz));
      if (list) {
        for (const c of list) {
          if (c.stamp === s || !c.enabled) continue;
          c.stamp = s;
          if (opts.bulletsOnly && !c.blocksBullets) continue;
          if (opts.filter && !opts.filter(c)) continue;
          const t = c.kind === 'box' ? rayAABB(origin, dir, c.box, bestT, n) : raySurface(origin, dir, c, bestT, n);
          if (t >= 0 && t < bestT) {
            bestT = t;
            best = c;
            terrainHit = false;
            bestNormal.copy(n);
          }
        }
      }
      const tExit = Math.min(tMaxX, tMaxZ);
      if (tExit >= bestT || tCell > bestT) break;
      tCell = tExit;
      if (tMaxX < tMaxZ) {
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }

    if (!best && !terrainHit) return null;
    return {
      t: bestT,
      point: new Vector3(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT),
      normal: bestNormal,
      collider: best,
      terrain: terrainHit,
    };
  }

  /** True when the segment a→b is unobstructed (for line-of-sight checks). */
  lineOfSight(a: Vector3, b: Vector3): boolean {
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return true;
    dir.divideScalar(len);
    const hit = this.raycast(a, dir, len - 0.05, { bulletsOnly: true });
    return hit === null;
  }
}
