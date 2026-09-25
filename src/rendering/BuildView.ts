import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Vector3,
} from 'three';
import { SLAB, TILE, TILE_H } from '../core/constants';
import type { BuildPiece } from '../building/BuildSystem';
import { CONE_HEIGHT, FULL_QUAD_MASK, FULL_WALL_MASK, type BuildMaterial, type BuildPieceType } from '../building/grid';
import type { BuildTarget } from '../building/targeting';
import { mergeAll, slabGeometry } from './geometry';
import { buildTexture } from './textures';

/**
 * Geometry for a piece in LOCAL space, where the local origin is the cell's
 * minimum corner (x*TILE, y*TILE_H, z*TILE). The same builders are used for
 * placed pieces and the ghost preview, so the preview is exactly the piece.
 */
function wallGeometry(rotation: number, mask: number): BufferGeometry {
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

function rampGeometry(dir: number): BufferGeometry {
  // Corners of the top surface (y at local surface height), CCW from above.
  const T = TILE;
  const H = TILE_H;
  const h = (x: number, z: number) => {
    switch (dir & 3) {
      case 0:
        return ((T - z) / T) * H;
      case 1:
        return (x / T) * H;
      case 2:
        return (z / T) * H;
      default:
        return ((T - x) / T) * H;
    }
  };
  const corners = [
    new Vector3(0, h(0, T), T),
    new Vector3(T, h(T, T), T),
    new Vector3(T, h(T, 0), 0),
    new Vector3(0, h(0, 0), 0),
  ];
  return withWhite(slabGeometry(corners, SLAB, 0xffffff, 1 / T));
}

function coneGeometry(mask: number): BufferGeometry {
  const T = TILE;
  const c = new Vector3(T / 2, CONE_HEIGHT, T / 2);
  const P: number[] = [];
  const tri = (a: Vector3, b: Vector3, d: Vector3) => {
    P.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
    P.push(a.x, a.y - 0.08, a.z, d.x, d.y - 0.08, d.z, b.x, b.y - 0.08, b.z);
  };
  for (let q = 0; q < 4; q++) {
    if (!(mask & (1 << q))) continue;
    const ix = q & 1;
    const iz = q >> 1;
    const corner = new Vector3(ix * T, 0, iz * T);
    const ex = new Vector3(ix * T, 0, T / 2); // edge midpoint on the x-side
    const ez = new Vector3(T / 2, 0, iz * T);
    // Orient so triangles face upward.
    const flip = (ix + iz) % 2 === 1;
    if (!flip) {
      tri(c, corner, ex);
      tri(c, ez, corner);
    } else {
      tri(c, ex, corner);
      tri(c, corner, ez);
    }
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

const geoCache = new Map<string, BufferGeometry>();
export function pieceGeometry(type: BuildPieceType, rotation: number, mask: number, rampDir: number): BufferGeometry {
  const key = `${type}:${type === 'wall' ? rotation & 1 : 0}:${mask}:${type === 'ramp' ? rampDir : 0}`;
  let g = geoCache.get(key);
  if (!g) {
    g = type === 'wall' ? wallGeometry(rotation, mask) : type === 'floor' ? floorGeometry(mask) : type === 'ramp' ? rampGeometry(rampDir) : coneGeometry(mask);
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
  private tileOn: MeshBasicMaterial;
  private tileOff: MeshBasicMaterial;
  private tileHover: MeshBasicMaterial;
  private tileOnHover: MeshBasicMaterial;
  private tileGeoWall: PlaneGeometry;
  private tileGeoQuad: PlaneGeometry;
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
    this.tileOn = new MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.38, depthWrite: false, depthTest: false, side: DoubleSide });
    this.tileOnHover = new MeshBasicMaterial({ color: 0xbff8ff, transparent: true, opacity: 0.62, depthWrite: false, depthTest: false, side: DoubleSide });
    this.tileOff = new MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false, side: DoubleSide, blending: AdditiveBlending });
    this.tileHover = new MeshBasicMaterial({ color: 0xff8a8a, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false, side: DoubleSide });
    this.tileGeoWall = new PlaneGeometry(TILE / 3 - 0.08, TILE_H / 3 - 0.08);
    this.tileGeoQuad = new PlaneGeometry(TILE / 2 - 0.1, TILE / 2 - 0.1);
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
      if (p.progress < 1) {
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
   * Show the edit grid over a piece. `removed` are selected (to be removed)
   * tiles, `hover` is the tile under the crosshair, `viewer` is used to push
   * wall tiles toward the player's side.
   */
  showEditGrid(piece: BuildPiece | null, centers: Vector3[], removed: Set<number>, hover: number, viewer: Vector3): void {
    if (!piece) {
      this.editGroup.visible = false;
      return;
    }
    this.editGroup.visible = true;
    while (this.editTiles.length < centers.length) {
      const m = new Mesh(this.tileGeoWall, this.tileOn);
      m.renderOrder = 7;
      this.editTiles.push(m);
      this.editGroup.add(m);
    }
    this.editTiles.forEach((m, i) => {
      if (i >= centers.length) {
        m.visible = false;
        return;
      }
      m.visible = true;
      const c = centers[i];
      m.position.copy(c);
      if (piece.type === 'wall') {
        m.geometry = this.tileGeoWall;
        if ((piece.rotation & 1) === 0) {
          m.rotation.set(0, Math.PI / 2, 0);
          m.position.x += viewer.x > c.x ? 0.13 : -0.13;
        } else {
          m.rotation.set(0, 0, 0);
          m.position.z += viewer.z > c.z ? 0.13 : -0.13;
        }
      } else {
        m.geometry = this.tileGeoQuad;
        m.rotation.set(-Math.PI / 2, 0, 0);
        m.position.y += viewer.y > c.y ? 0.14 : -0.14;
      }
      const isRemoved = removed.has(i);
      m.material = isRemoved ? (i === hover ? this.tileHover : this.tileOff) : i === hover ? this.tileOnHover : this.tileOn;
    });
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
    this.tileGeoWall.dispose();
    this.tileGeoQuad.dispose();
    this.group.removeFromParent();
  }
}

