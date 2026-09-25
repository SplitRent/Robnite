import { BufferAttribute, BufferGeometry, Color, Float32BufferAttribute, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Geometry helpers producing non-indexed geometry with position/normal/uv/color. */

const tmpColor = new Color();

export function ensureColor(geo: BufferGeometry, color: number | Color, ao?: { minY: number; maxY: number; strength: number }): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((g.getAttribute('position').count) * 2), 2));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  tmpColor.set(color as Color);
  for (let i = 0; i < pos.count; i++) {
    let k = 1;
    if (ao) {
      const t = (pos.getY(i) - ao.minY) / Math.max(0.001, ao.maxY - ao.minY);
      k = 1 - ao.strength * (1 - Math.min(1, t * 3));
    }
    colors[i * 3] = tmpColor.r * k;
    colors[i * 3 + 1] = tmpColor.g * k;
    colors[i * 3 + 2] = tmpColor.b * k;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/**
 * Axis-aligned box with world-space planar UVs (so detail textures tile
 * uniformly across differently sized boxes).
 */
export function boxGeometry(min: [number, number, number], max: [number, number, number], color: number, uvScale = 0.25, ao = 0): BufferGeometry {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const P: number[] = [];
  const N: number[] = [];
  const U: number[] = [];
  const Cc: number[] = [];
  const c = tmpColor.set(color);
  const face = (a: number[], b: number[], cc: number[], d: number[], n: number[], uvAxes: [number, number]) => {
    const quad = [a, b, cc, a, cc, d];
    for (const v of quad) {
      P.push(v[0], v[1], v[2]);
      N.push(n[0], n[1], n[2]);
      U.push(v[uvAxes[0]] * uvScale, v[uvAxes[1]] * uvScale);
      let k = 1;
      if (ao > 0 && n[1] === 0) {
        const t = (v[1] - y0) / Math.max(0.001, y1 - y0);
        k = 1 - ao * (1 - Math.min(1, t * 2.5 + 0.15));
      }
      if (n[1] < 0) k *= 0.7;
      Cc.push(c.r * k, c.g * k, c.b * k);
    }
  };
  face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [2, 1]);
  face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [2, 1]);
  face([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [0, 2]);
  face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [0, 2]);
  face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [0, 1]);
  face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [0, 1]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.setAttribute('color', new Float32BufferAttribute(Cc, 3));
  return g;
}

export function transformed(geo: BufferGeometry, m: Matrix4): BufferGeometry {
  const g = geo.clone();
  g.applyMatrix4(m);
  return g;
}

/** Merge a list of compatible non-indexed geometries (all with the same attributes). */
export function mergeAll(list: BufferGeometry[]): BufferGeometry | null {
  if (!list.length) return null;
  const normalized = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) n.deleteAttribute(name);
    return n;
  });
  const merged = mergeGeometries(normalized, false);
  if (!merged) console.error('[Robnite][Rendering] failed to merge geometries');
  return merged;
}

/** Slab between a top quad (4 corners, CCW from above) and the same quad lowered by `thickness`. */
export function slabGeometry(top: Vector3[], thickness: number, color: number, uvScale = 0.25): BufferGeometry {
  const bottom = top.map((v) => v.clone().setY(v.y - thickness));
  const P: number[] = [];
  const U: number[] = [];
  const push = (vs: Vector3[]) => {
    for (const v of vs) {
      P.push(v.x, v.y, v.z);
      U.push((v.x + v.y) * uvScale, (v.z + v.y) * uvScale);
    }
  };
  const [a, b, c, d] = top;
  const [e, f, g, h] = bottom;
  push([a, b, c, a, c, d]); // top
  push([e, g, f, e, h, g]); // bottom
  push([a, e, f, a, f, b]);
  push([b, f, g, b, g, c]);
  push([c, g, h, c, h, d]);
  push([d, h, e, d, e, a]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(U, 2));
  geo.computeVertexNormals();
  return ensureColor(geo, color);
}
