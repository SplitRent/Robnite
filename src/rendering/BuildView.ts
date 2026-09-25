import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { SLAB, TILE, TILE_H } from '../core/constants';
import type { BuildPiece } from '../building/BuildSystem';
import { FULL_QUAD_MASK, FULL_WALL_MASK, RAMP_SPIRAL, coneCenterHeight, coneCornerHeights, wallTriangleCorner, type BuildMaterial, type BuildPieceType } from '../building/grid';
import type { BuildTarget } from '../building/targeting';
import { mergeAll, slabGeometry } from './geometry';
import { buildTexture } from './textures';

/**
 * Geometry for a piece in LOCAL space, where the local origin is the cell's
 * minimum corner (x*TILE, y*TILE_H, z*TILE). The same builders are used for
 * placed pieces and the ghost preview, so the preview is exactly the piece.
 */
function wallGeometry(rotation: number, mask: number): BufferGeometry {
  const corner = wallTriangleCorner(mask);
  if (corner >= 0) return triangleWallGeometry(rotation, corner);
  const parts: BufferGeometry[] = [];
  const tw = TILE / 3;
  const th = TILE_H / 3;
  const gap = mask === FULL_WALL_MASK ? 0 : 0.015;
  for (let i = 0; i < 9; i++) {
    if (!(mask & (1 << i))) continue;
    const row = Math.floor(i / 3);
    const col = i % 3;
    const y0 = row * th + gap;
    const y1 = (row + 1) * th - gap;
    const a0 = col * tw + gap;
    const a1 = (col + 1) * tw - gap;
    const g = new BoxGeometry(1, 1, 1).toNonIndexed();
    if ((rotation & 1) === 0) {
      g.scale(SLAB, y1 - y0, a1 - a0);
      g.translate(0, (y0 + y1) / 2, (a0 + a1) / 2);
    } else {
      g.scale(a1 - a0, y1 - y0, SLAB);
      g.translate((a0 + a1) / 2, (y0 + y1) / 2, 0);
    }
    remapUV(g, rotation, col, row, 3);
    parts.push(g);
  }
  return mergeAll(parts.map(withWhite))!;
}

function floorGeometry(mask: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hw = TILE / 2;
  for (let q = 0; q < 4; q++) {
    if (!(mask & (1 << q))) continue;
    const ix = q & 1;
    const iz = q >> 1;
    const g = new BoxGeometry(hw - (mask === FULL_QUAD_MASK ? 0 : 0.02), SLAB, hw - (mask === FULL_QUAD_MASK ? 0 : 0.02)).toNonIndexed();
    g.translate(ix * hw + hw / 2, 0, iz * hw + hw / 2);
    parts.push(g);
  }
  const g = mergeAll(parts.map(withWhite))!;
  scaleUV(g, 2);
  return g;
}

function rampGeometry(dir: number, mask: number): BufferGeometry {
  const T = TILE;
  const H = TILE_H;
  // Local progress (0..1) across the cell toward direction d.
  const prog = (d: number, x: number, z: number) => {
    switch (d & 3) {
      case 0:
        return (T - z) / T;
      case 1:
        return x / T;
      case 2:
        return z / T;
      default:
        return (T - x) / T;
    }
  };
  // A sloped slab over the rectangle [xa,xb]x[za,zb] (corners CCW from above).
  const slab = (xa: number, xb: number, za: number, zb: number, h: (x: number, z: number) => number) =>
    slabGeometry(
      [new Vector3(xa, h(xa, zb), zb), new Vector3(xb, h(xb, zb), zb), new Vector3(xb, h(xb, za), za), new Vector3(xa, h(xa, za), za)],
      SLAB,
      0xffffff,
      1 / T,
    );
  const halfRect = (quads: number): [number, number, number, number] => {
    const xs = [quads & 0b0101 ? 0 : T / 2, quads & 0b1010 ? T : T / 2];
    const zs = [quads & 0b0011 ? 0 : T / 2, quads & 0b1100 ? T : T / 2];
    return [xs[0], xs[1], zs[0], zs[1]];
  };
  // One flight of stairs over the rectangle, rising toward d from `base` by
  // `rise` across the full cell. Like Fortnite's ramps it looks like steps
  // (with a solid sloped underside) while collision stays a smooth slope.
  const STEPS = 8;
  const flight = (xa: number, xb: number, za: number, zb: number, d: number, base: number, rise: number): BufferGeometry[] => {
    const parts: BufferGeometry[] = [];
    const stepRise = rise / STEPS;
    parts.push(slab(xa, xb, za, zb, (x, z) => base + prog(d, x, z) * rise - stepRise * 0.55));
    const alongX = (d & 1) === 1;
    for (let i = 0; i < STEPS; i++) {
      const t0 = i / STEPS;
      const t1 = (i + 1) / STEPS;
      // Interval of this step along the rising axis, in local coordinates.
      let a0: number;
      let a1: number;
      if (d === 1 || d === 2) [a0, a1] = [t0 * T, t1 * T];
      else [a0, a1] = [T - t1 * T, T - t0 * T];
      const lo = alongX ? Math.max(a0, xa) : Math.max(a0, za);
      const hi = alongX ? Math.min(a1, xb) : Math.min(a1, zb);
      if (hi - lo < 0.01) continue;
      const top = base + t1 * rise - stepRise * 0.25;
      const bottom = Math.max(base - 0.05, top - stepRise * 1.6);
      const g = new BoxGeometry(1, 1, 1).toNonIndexed();
      if (alongX) {
        g.scale(hi - lo, top - bottom, zb - za);
        g.translate((lo + hi) / 2, (top + bottom) / 2, (za + zb) / 2);
      } else {
        g.scale(xb - xa, top - bottom, hi - lo);
        g.translate((xa + xb) / 2, (top + bottom) / 2, (lo + hi) / 2);
      }
      scaleUV(g, 1);
      parts.push(g);
    }
    return parts;
  };
  const quads = mask & FULL_QUAD_MASK;
  let parts: BufferGeometry[];
  if (mask & RAMP_SPIRAL) {
    const [ax, bx, az, bz] = halfRect(quads);
    const [cx, dx, cz, dz] = halfRect(FULL_QUAD_MASK & ~quads);
    parts = [...flight(ax, bx, az, bz, dir & 3, 0, H * 0.5), ...flight(cx, dx, cz, dz, (dir + 2) & 3, H * 0.5, H * 0.5)];
  } else if (quads !== FULL_QUAD_MASK) {
    const [ax, bx, az, bz] = halfRect(quads);
    parts = flight(ax, bx, az, bz, dir & 3, 0, H);
  } else {
    parts = flight(0, T, 0, T, dir & 3, 0, H);
  }
  return mergeAll(parts.map(withWhite))!;
}

/** Triangle-cut wall (see wallTriangleCorner): a diagonal prism. */
function triangleWallGeometry(rotation: number, corner: number): BufferGeometry {
  const T = TILE;
  const H = TILE_H;
  // Triangle in wall-local (along, y) space.
  const tri: [number, number][] =
    corner === 0 ? [[0, H], [T, H], [T, 0]] : corner === 1 ? [[0, 0], [0, H], [T, H]] : corner === 2 ? [[0, 0], [T, 0], [T, H]] : [[0, 0], [T, 0], [0, H]];
  const half = SLAB / 2;
  const at = (a: number, y: number, side: number) => ((rotation & 1) === 0 ? [side * half, y, a] : [a, y, side * half]);
  const P: number[] = [];
  const U: number[] = [];
  const face = (pts: number[][]) => {
    // Build materials are double-sided, so one winding is enough.
    for (const v of pts) {
      P.push(v[0], v[1], v[2]);
      U.push(((rotation & 1) === 0 ? v[2] : v[0]) / T, v[1] / H);
    }
  };
  for (const side of [-1, 1]) face(tri.map(([a, y]) => at(a, y, side)));
  for (let i = 0; i < 3; i++) {
    const [a0, y0] = tri[i];
    const [a1, y1] = tri[(i + 1) % 3];
    const p0 = at(a0, y0, -1);
    const p1 = at(a1, y1, -1);
    const p2 = at(a1, y1, 1);
    const p3 = at(a0, y0, 1);
    face([p0, p1, p2]);
    face([p0, p2, p3]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  return withWhite(g);
}

function coneGeometry(mask: number): BufferGeometry {
  // Four faces (centre + edge). Edited tiles lift their corner to the peak.
  const T = TILE;
  const h = coneCornerHeights(mask);
  const corner = (q: number) => new Vector3((q & 1) * T, h[q], (q >> 1) * T);
  const c = new Vector3(T / 2, coneCenterHeight(mask), T / 2);
  const P: number[] = [];
  const thick = 0.1;
  const up = new Vector3();
  const tri = (a: Vector3, b: Vector3, d: Vector3) => {
    // Top faces point up; the underside sits a little lower, facing down.
    up.subVectors(b, a).cross(new Vector3().subVectors(d, a));
    if (up.y < 0) [b, d] = [d, b];
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
    P.push(a.x, a.y - thick, a.z, d.x, d.y - thick, d.z, b.x, b.y - thick, b.z);
  };
  const edges: [number, number][] = [
    [0, 1],
    [1, 3],
    [3, 2],
    [2, 0],
  ];
  for (const [qa, qb] of edges) {
    const a = corner(qa);
    const b = corner(qb);
    tri(c, a, b);
    // Rim between top and underside along the outer edge.
    const a2 = a.clone().setY(a.y - thick);
    const b2 = b.clone().setY(b.y - thick);
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, b2.x, b2.y, b2.z, a.x, a.y, a.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  const U: number[] = [];
  for (let i = 0; i < P.length; i += 3) U.push(P[i] / T, P[i + 2] / T);
  g.setAttribute('uv', new Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  return withWhite(g);
}

function withWhite(g: BufferGeometry): BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3).fill(1);
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function remapUV(g: BufferGeometry, _rotation: number, col: number, row: number, n: number): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / n, (row + uv.getY(i)) / n);
}

function scaleUV(g: BufferGeometry, s: number): void {
  const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s);
}

/** Write a draped tile's points into a (reused) geometry. */
function setTileGeometry(g: BufferGeometry, t: EditTile): void {
  const count = (t.n + 1) * (t.n + 1);
  let pos = g.getAttribute('position') as Float32BufferAttribute | undefined;
  if (!pos || pos.count !== count) {
    pos = new Float32BufferAttribute(new Float32Array(count * 3), 3);
    g.setAttribute('position', pos);
    const idx: number[] = [];
    for (let r = 0; r < t.n; r++) {
      for (let c = 0; c < t.n; c++) {
        const a = r * (t.n + 1) + c;
        idx.push(a, a + 1, a + t.n + 1, a + 1, a + t.n + 2, a + t.n + 1);
      }
    }
    g.setIndex(idx);
  }
  t.points.forEach((p, i) => pos!.setXYZ(i, p.x, p.y, p.z));
  pos.needsUpdate = true;
  g.computeBoundingSphere();
}

/** Perimeter of a draped tile as a line loop. */
function setTileOutline(g: BufferGeometry, t: EditTile): void {
  const n = t.n;
  const at = (r: number, c: number) => t.points[r * (n + 1) + c];
  const ring: Vector3[] = [];
  for (let c = 0; c < n; c++) ring.push(at(0, c));
  for (let r = 0; r < n; r++) ring.push(at(r, n));
  for (let c = n; c > 0; c--) ring.push(at(n, c));
  for (let r = n; r > 0; r--) ring.push(at(r, 0));
  let pos = g.getAttribute('position') as Float32BufferAttribute | undefined;
  if (!pos || pos.count !== ring.length) {
    pos = new Float32BufferAttribute(new Float32Array(ring.length * 3), 3);
    g.setAttribute('position', pos);
  }
  ring.forEach((p, i) => pos!.setXYZ(i, p.x, p.y, p.z));
  pos.needsUpdate = true;
}

/** Flat chevron (^) in the XY plane pointing along +Y, for ramp edit arrows. */
function chevronGeometry(): BufferGeometry {
  const P: number[] = [];
  const arm = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const nx = (-dy / len) * w;
    const ny = (dx / len) * w;
    P.push(x0 - nx, y0 - ny, 0, x1 - nx, y1 - ny, 0, x1 + nx, y1 + ny, 0);
    P.push(x0 - nx, y0 - ny, 0, x1 + nx, y1 + ny, 0, x0 + nx, y0 + ny, 0);
  };
  arm(-0.45, -0.1, 0, 0.12, 0.035);
  arm(0.45, -0.1, 0, 0.12, 0.035);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(P, 3));
  return g;
}

const geoCache = new Map<string, BufferGeometry>();
export function pieceGeometry(type: BuildPieceType, rotation: number, mask: number, rampDir: number): BufferGeometry {
  const key = `${type}:${type === 'wall' ? rotation & 1 : 0}:${mask}:${type === 'ramp' ? rampDir : 0}`;
  let g = geoCache.get(key);
  if (!g) {
    g = type === 'wall' ? wallGeometry(rotation, mask) : type === 'floor' ? floorGeometry(mask) : type === 'ramp' ? rampGeometry(rampDir, mask) : coneGeometry(mask);
    geoCache.set(key, g);
  }
  return g;
}

const edgeCache = new Map<BufferGeometry, EdgesGeometry>();
function edgesOf(g: BufferGeometry): EdgesGeometry {
  let e = edgeCache.get(g);
  if (!e) {
    e = new EdgesGeometry(g, 25);
    edgeCache.set(g, e);
  }
  return e;
}

export function cellOrigin(g: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(g.x * TILE, g.y * TILE_H, g.z * TILE);
}

interface PieceVisual {
  mesh: Mesh;
  material: MeshStandardMaterial;
  mask: number;
  rampDir: number;
  born: number;
}

/**
 * One edit tile, draped over the piece: a (n+1)x(n+1) grid of world points
 * (row-major) that follows the piece surface, lifted slightly toward the viewer.
 */
export interface EditTile {
  points: Vector3[];
  n: number;
  center: Vector3;
  /** Surface normal at the centre, facing the viewer. */
  normal: Vector3;
  /** Not a tile (the hole in the middle of the ramp grid). */
  hidden?: boolean;
  /** Force gray (true) / blue (false); by default selected tiles are gray. */
  gray?: boolean;
  /** Draw a chevron pointing (up the tile) along this horizontal direction. */
  arrow?: Vector3;
}

const MATERIAL_TINT: Record<BuildMaterial, number> = { wood: 0xffffff, stone: 0xffffff, metal: 0xffffff };

/** Renders placed build pieces, the ghost preview and the edit grid. */
export class BuildView {
  readonly group = new Group();
  private visuals = new Map<number, PieceVisual>();
  private baseMaterials: Record<BuildMaterial, MeshStandardMaterial>;
  // Ghost
  private ghost: Mesh;
  private ghostEdges: LineSegments;
  private ghostValid: MeshBasicMaterial;
  private ghostInvalid: MeshBasicMaterial;
  private edgeValid: LineBasicMaterial;
  private edgeInvalid: LineBasicMaterial;
  // Edit grid
  private editGroup = new Group();
  private editTiles: Mesh[] = [];
  private editEdges: LineLoop[] = [];
  private edgeMat = new LineBasicMaterial({ color: 0xe8f8ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  private tileOn: MeshBasicMaterial;
  private tileOff: MeshBasicMaterial;
  private tileHover: MeshBasicMaterial;
  private tileOnHover: MeshBasicMaterial;
  private arrows: Mesh[] = [];
  private arrowGeo: BufferGeometry;
  private arrowMat: MeshBasicMaterial;
  private time = 0;

  constructor(private shadows: boolean) {
    const mk = (m: BuildMaterial) =>
      new MeshStandardMaterial({ map: buildTexture(m), vertexColors: true, color: MATERIAL_TINT[m], roughness: m === 'metal' ? 0.45 : 0.85, metalness: m === 'metal' ? 0.45 : 0.02, side: DoubleSide });
    this.baseMaterials = { wood: mk('wood'), stone: mk('stone'), metal: mk('metal') };
    this.ghostValid = new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide });
    this.ghostInvalid = new MeshBasicMaterial({ color: 0xff4a4a, transparent: true, opacity: 0.26, depthWrite: false, side: DoubleSide });
    this.edgeValid = new LineBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.95 });
    this.edgeInvalid = new LineBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.95 });
    this.ghost = new Mesh(new BufferGeometry(), this.ghostValid);
    this.ghost.renderOrder = 5;
    this.ghost.visible = false;
    this.ghostEdges = new LineSegments(new BufferGeometry(), this.edgeValid);
    this.ghostEdges.renderOrder = 6;
    this.ghostEdges.visible = false;
    this.group.add(this.ghost, this.ghostEdges);
    // Fortnite edit colours: blue = stays, gray = cut away.
    const tileMat = (color: number, opacity: number) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: DoubleSide });
    this.tileOn = tileMat(0x1fb6f5, 0.62);
    this.tileOnHover = tileMat(0x7fdcff, 0.75);
    this.tileOff = tileMat(0x8d949c, 0.6);
    this.tileHover = tileMat(0xc2c7cc, 0.7);
    this.arrowGeo = chevronGeometry();
    this.arrowMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: DoubleSide });
    this.editGroup.visible = false;
    this.group.add(this.editGroup);
  }

  add(piece: BuildPiece, time: number): void {
    const material = this.baseMaterials[piece.material].clone();
    const mesh = new Mesh(pieceGeometry(piece.type, piece.rotation, piece.editMask, piece.rampDir), material);
    mesh.position.copy(cellOrigin(piece.grid));
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = this.shadows;
    mesh.userData.pieceId = piece.id;
    this.group.add(mesh);
    this.visuals.set(piece.id, { mesh, material, mask: piece.editMask, rampDir: piece.rampDir, born: time });
  }

  refresh(piece: BuildPiece): void {
    const v = this.visuals.get(piece.id);
    if (!v) return;
    if (v.mask !== piece.editMask || v.rampDir !== piece.rampDir) {
      v.mesh.geometry = pieceGeometry(piece.type, piece.rotation, piece.editMask, piece.rampDir);
      v.mask = piece.editMask;
      v.rampDir = piece.rampDir;
    }
  }

  remove(pieceId: number): void {
    const v = this.visuals.get(pieceId);
    if (!v) return;
    v.mesh.removeFromParent();
    v.material.dispose();
    this.visuals.delete(pieceId);
  }

  /** Per-frame: health tint, build-in shimmer and placement pop. */
  update(time: number, pieces: Map<number, BuildPiece>): void {
    this.time = time;
    for (const [id, v] of this.visuals) {
      const p = pieces.get(id);
      if (!p) continue;
      const age = time - v.born;
      const pop = age < 0.12 ? 0.94 + (age / 0.12) * 0.06 : 1;
      v.mesh.scale.setScalar(pop);
      if (pop !== 1) {
        // Scale around the piece centre so the pop never shifts the piece.
        const b = p.bounds;
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const o = cellOrigin(p.grid);
        v.mesh.position.set(cx + (o.x - cx) * pop, cy + (o.y - cy) * pop, cz + (o.z - cz) * pop);
      } else v.mesh.position.copy(cellOrigin(p.grid));
      const hp = p.health / p.maxHealth;
      const c = v.material.color;
      // Phased ("yellow") builds: see-through until the player leaves them.
      if (v.material.transparent !== p.phased) {
        v.material.transparent = p.phased;
        v.material.opacity = p.phased ? 0.5 : 1;
        v.material.depthWrite = !p.phased;
        v.material.needsUpdate = true;
        v.mesh.castShadow = this.shadows && !p.phased;
      }
      if (p.phased) {
        c.setRGB(1, 0.86, 0.3);
        v.material.emissive.setRGB(0.35, 0.27, 0.02);
      } else if (p.progress < 1) {
        // Constructing: blueprint tint that fades in to the material.
        c.setRGB(0.55 + 0.45 * p.progress, 0.8 + 0.2 * p.progress, 1);
        v.material.emissive.setRGB(0.05 * (1 - p.progress), 0.2 * (1 - p.progress), 0.3 * (1 - p.progress));
      } else {
        const dmg = 1 - hp;
        c.setRGB(1 - dmg * 0.25, 1 - dmg * 0.45, 1 - dmg * 0.45);
        v.material.emissive.setRGB(0, 0, 0);
      }
    }
  }

  // ------------------------------------------------------------- ghost

  showGhost(target: BuildTarget | null): void {
    if (!target) {
      this.ghost.visible = false;
      this.ghostEdges.visible = false;
      return;
    }
    const mask = target.piece === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK;
    const geo = pieceGeometry(target.piece, target.rotation, mask, target.rotation);
    this.ghost.geometry = geo;
    this.ghostEdges.geometry = edgesOf(geo);
    const o = cellOrigin(target.grid);
    this.ghost.position.copy(o);
    this.ghostEdges.position.copy(o);
    this.ghost.material = target.valid ? this.ghostValid : this.ghostInvalid;
    this.ghostEdges.material = target.valid ? this.edgeValid : this.edgeInvalid;
    const pulse = 0.2 + Math.sin(this.time * 6) * 0.04;
    this.ghostValid.opacity = pulse;
    this.ghost.visible = true;
    this.ghostEdges.visible = true;
  }

  // ------------------------------------------------------------- edit grid

  /**
   * Show the edit grid. Each tile is a quad laid on the piece surface
   * (`axisX`/`axisY` span the tile, `normal` faces the player). `selected`
   * tiles are the ones the player has picked (shown gray = removed, unless the
   * tile says otherwise); `hover` is the tile under the crosshair.
   */
  showEditGrid(piece: BuildPiece | null, tiles: EditTile[], selected: Set<number>, hover: number): void {
    if (!piece) {
      this.editGroup.visible = false;
      return;
    }
    this.editGroup.visible = true;
    while (this.editTiles.length < tiles.length) {
      const m = new Mesh(new BufferGeometry(), this.tileOn);
      m.renderOrder = 7;
      m.frustumCulled = false;
      this.editTiles.push(m);
      this.editGroup.add(m);
    }
    const basis = new Matrix4();
    let arrowCount = 0;
    this.editTiles.forEach((m, i) => {
      const t = tiles[i];
      if (!t || t.hidden) {
        m.visible = false;
        if (this.editEdges[i]) this.editEdges[i].visible = false;
        return;
      }
      m.visible = true;
      setTileGeometry(m.geometry, t);
      // Fortnite-style bright outline around each tile.
      let edge = this.editEdges[i];
      if (!edge) {
        edge = new LineLoop(new BufferGeometry(), this.edgeMat);
        edge.renderOrder = 8;
        edge.frustumCulled = false;
        this.editEdges[i] = edge;
        this.editGroup.add(edge);
      }
      edge.visible = true;
      setTileOutline(edge.geometry, t);
      const gray = t.gray ?? selected.has(i);
      m.material = gray ? (i === hover ? this.tileHover : this.tileOff) : i === hover ? this.tileOnHover : this.tileOn;
      if (t.arrow) {
        let a = this.arrows[arrowCount];
        if (!a) {
          a = new Mesh(this.arrowGeo, this.arrowMat);
          a.renderOrder = 8;
          this.arrows.push(a);
          this.editGroup.add(a);
        }
        a.visible = true;
        // Point the chevron along the arrow direction projected onto the tile.
        const ay = t.arrow.clone().addScaledVector(t.normal, -t.arrow.dot(t.normal)).normalize();
        const ax = new Vector3().crossVectors(ay, t.normal);
        a.quaternion.setFromRotationMatrix(basis.makeBasis(ax, ay, t.normal));
        a.position.copy(t.center).addScaledVector(t.normal, 0.03);
        arrowCount++;
      }
    });
    for (let i = arrowCount; i < this.arrows.length; i++) this.arrows[i].visible = false;
  }

  get pieceCount(): number {
    return this.visuals.size;
  }

  dispose(): void {
    for (const id of [...this.visuals.keys()]) this.remove(id);
    for (const m of Object.values(this.baseMaterials)) m.dispose();
    this.ghostValid.dispose();
    this.ghostInvalid.dispose();
    this.edgeValid.dispose();
    this.edgeInvalid.dispose();
    this.tileOn.dispose();
    this.tileOff.dispose();
    this.tileHover.dispose();
    this.tileOnHover.dispose();
    for (const m of this.editTiles) m.geometry.dispose();
    for (const e of this.editEdges) e.geometry.dispose();
    this.edgeMat.dispose();
    this.arrowGeo.dispose();
    this.arrowMat.dispose();
    this.group.removeFromParent();
  }
}

