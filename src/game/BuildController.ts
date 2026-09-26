import { Vector3 } from 'three';
import { EDIT_REACH_BUILD, EDIT_REACH_COMBAT, SLAB, TILE, TILE_H } from '../core/constants';
import { computeBuildTarget, type BuildTarget } from '../building/targeting';
import { DIR_VECTORS, FULL_QUAD_MASK, RAMP_SPIRAL, rampSurfaceHeight } from '../building/grid';
import { rampCellActive, rampCellRange, removedTiles, selectionToEdit, tileAt } from '../building/edits';
import { raySurface } from '../physics/collision';
import type { EditTile } from '../rendering/BuildView';
import type { BuildPiece } from '../building/BuildSystem';
import type { Match } from './Match';
import type { NetworkAdapter } from '../networking/NetworkAdapter';
import type { BuildView } from '../rendering/BuildView';
import type { GameplaySettings } from '../settings/settings';

interface EditState {
  pieceId: number;
  selection: Set<number>;
  /** Drag order of selected tiles (ramps use it for direction). */
  path: number[];
  initial: Set<number>;
  hover: number;
  dragMode: 'add' | 'remove' | null;
  changed: boolean;
  startedAt: number;
}

export interface CameraRay {
  origin: Vector3;
  dir: Vector3;
}

/**
 * Client-side build + edit interaction. The ghost shown to the player is the
 * exact BuildTarget sent to the simulation when placing — the ghost is the
 * contract.
 */
export class BuildController {
  target: BuildTarget | null = null;
  edit: EditState | null = null;
  private lastPlacedKey = '';
  private notice: ((text: string) => void) | null = null;

  constructor(private match: Match, private adapter: NetworkAdapter, private view: BuildView, public settings: GameplaySettings) {}

  onNotice(fn: (text: string) => void): void {
    this.notice = fn;
  }

  private get human() {
    return this.match.human;
  }

  private pieceInfo = (id: number) => {
    const p = this.match.builds.pieces.get(id);
    return p ? { type: p.type, grid: p.grid, rotation: p.rampDir } : null;
  };

  /** Recompute the crosshair target and ghost for the selected piece. */
  updateTarget(ray: CameraRay): void {
    const h = this.human;
    if (h.buildPiece === null || !h.alive || h.air !== 'none' || this.edit) {
      this.target = null;
      this.view.showGhost(null);
      return;
    }
    const eye = h.eye(new Vector3());
    const t = computeBuildTarget(this.match.world.collision, { origin: ray.origin, dir: ray.dir, eye, feet: h.pos, piece: h.buildPiece, userRotation: h.buildRotation, pieceInfo: this.pieceInfo });
    this.match.builds.check(t, h);
    this.target = t;
    // Aiming at a slot that is already built: show nothing over the real piece.
    this.view.showGhost(t.reason === 'Blocked by existing structure' ? null : t);
  }

  /** Place on click, and keep placing while held whenever the target changes. */
  handleFire(pressed: boolean, held: boolean): void {
    const t = this.target;
    if (!t || !this.human.buildPiece) return;
    // A tap can press and release within one frame: `pressed` still counts.
    if (!held && !pressed) {
      this.lastPlacedKey = '';
      return;
    }
    if (!t.valid) return;
    if (pressed || t.key !== this.lastPlacedKey) {
      // Send a copy of exactly what the ghost shows.
      this.adapter.sendAction({ type: 'place', target: { ...t, grid: { ...t.grid } } });
      this.lastPlacedKey = held ? t.key : '';
    }
  }

  // ------------------------------------------------------------ editing

  /** The player's own build piece under the crosshair (within edit range), if any. */
  pieceUnderCrosshair(ray: CameraRay): BuildPiece | null {
    const h = this.human;
    const builds = this.match.builds;
    // Build mode: the piece in the slot your blueprint points at has priority
    // (e.g. holding floor edits the floor you're aiming at).
    const t = this.target;
    if (h.buildPiece && t && t.reason === 'Blocked by existing structure') {
      const p = builds.pieceByKey(t.key);
      if (p && p.type === t.piece && builds.canEdit(p, h).valid) return p;
    }
    const eye = h.eye(new Vector3());
    const toEye = eye.clone().sub(ray.origin).dot(ray.dir);
    const t0 = Math.max(0, toEye - 0.25);
    const start = ray.origin.clone().addScaledVector(ray.dir, t0);
    // Reach from the eye: ~1 tile with a weapon out, ~2 tiles in build mode.
    const reach = Math.max(0, toEye - t0) + (h.buildPiece ? EDIT_REACH_BUILD : EDIT_REACH_COMBAT);
    const hit = this.match.world.collision.raycast(start, ray.dir, reach, { includeTerrain: true });
    const piece = builds.pieceFromCollider(hit?.collider);
    if (!piece) return this.pieceByEditedOpening(start, ray.dir, hit ? hit.t : reach);
    return builds.canEdit(piece, h).valid ? piece : null;
  }

  /**
   * Looking through a fully opened tile of an edited wall should still select
   * it: march the ray through the owner's pieces' bounds.
   */
  private pieceByEditedOpening(start: Vector3, dir: Vector3, maxT: number): BuildPiece | null {
    let best: BuildPiece | null = null;
    let bestT = maxT;
    for (const p of this.match.builds.pieces.values()) {
      if (p.ownerId !== this.human.id || !this.match.builds.isEdited(p)) continue;
      const b = p.bounds;
      const t = rayBox(start, dir, b);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = p;
      }
    }
    return best && this.match.builds.canEdit(best, this.human).valid ? best : null;
  }

  beginEdit(ray: CameraRay, now: number): boolean {
    const piece = this.pieceUnderCrosshair(ray);
    if (!piece) return false;
    const initial = removedTiles(piece.type, piece.editMask);
    this.edit = { pieceId: piece.id, selection: new Set(initial), path: [], initial, hover: -1, dragMode: null, changed: false, startedAt: now };
    this.human.editingPieceId = piece.id;
    this.target = null;
    this.view.showGhost(null);
    return true;
  }

  private tileUnderRay(piece: BuildPiece, ray: CameraRay): number {
    const g = piece.grid;
    let t: number;
    const col = piece.colliders[0];
    if (piece.type === 'ramp' && col && col.kind === 'surface') {
      // Hit the slope the grid is drawn on so the hovered tile is the one under
      // the crosshair (for a cut-down ramp that is the full ramp's slope).
      const surface = { ...col, height: (x: number, z: number) => rampDisplayHeight(piece, x, z) };
      const st = raySurface(ray.origin, ray.dir, surface, 40, new Vector3());
      if (st >= 0) {
        const hp = ray.origin.clone().addScaledVector(ray.dir, st);
        return tileAt(piece.type, g, piece.rotation, hp);
      }
    }
    if (piece.type === 'wall') {
      if ((piece.rotation & 1) === 0) t = (g.x * TILE - ray.origin.x) / ray.dir.x;
      else t = (g.z * TILE - ray.origin.z) / ray.dir.z;
    } else {
      // Floors and cones: the flat grid plane at the piece's base.
      const y = g.y * TILE_H + (piece.type === 'ramp' ? TILE_H / 2 : 0);
      t = (y - ray.origin.y) / ray.dir.y;
    }
    if (!Number.isFinite(t) || t < 0) return -1;
    const p = ray.origin.clone().addScaledVector(ray.dir, t);
    // Must be within the piece's footprint (with a little slack).
    const b = piece.bounds;
    const s = 0.6;
    if (p.x < b.minX - s || p.x > b.maxX + s || p.y < b.minY - s || p.y > b.maxY + s || p.z < b.minZ - s || p.z > b.maxZ + s) return -1;
    return tileAt(piece.type, g, piece.rotation, p);
  }

  /** Per-frame edit update. Returns false if edit mode ended. */
  updateEdit(ray: CameraRay, fire: { pressed: boolean; held: boolean; released: boolean }, viewer: Vector3): boolean {
    const e = this.edit;
    if (!e) return false;
    const piece = this.match.builds.pieces.get(e.pieceId);
    if (!piece || !this.human.alive || !this.match.builds.canEdit(piece, this.human).valid) {
      this.cancelEdit();
      return false;
    }
    e.hover = this.tileUnderRay(piece, ray);
    if (piece.type === 'ramp') {
      // Fortnite-style ramp edit: press on a tile and drag toward where the
      // ramp should rise; release to confirm.
      if (fire.pressed && e.hover >= 0) {
        e.selection = new Set([e.hover]);
        e.path = [e.hover];
        e.dragMode = 'add';
      }
      if ((fire.held || fire.pressed) && e.dragMode && e.hover >= 0 && e.path[e.path.length - 1] !== e.hover && !e.path.includes(e.hover)) {
        e.path.push(e.hover);
        e.selection.add(e.hover);
        e.changed = true;
      }
    } else {
      if (fire.pressed && e.hover >= 0) {
        e.dragMode = e.selection.has(e.hover) ? 'remove' : 'add';
      }
      // Apply on the press itself too (a click can press and release within one frame).
      if ((fire.held || fire.pressed) && e.dragMode && e.hover >= 0) {
        const had = e.selection.has(e.hover);
        if (e.dragMode === 'add' && !had) e.selection.add(e.hover);
        if (e.dragMode === 'remove' && had) e.selection.delete(e.hover);
        e.changed = e.changed || had !== e.selection.has(e.hover);
      }
    }
    if (fire.released && e.dragMode) {
      e.dragMode = null;
      if (this.settings.editOnRelease && e.changed) {
        this.commitEdit();
        return false;
      }
    }
    this.view.showEditGrid(piece, editTiles(piece, viewer, e.dragMode ? e.path : null), e.selection, e.hover);
    return true;
  }

  commitEdit(): void {
    const e = this.edit;
    if (!e) return;
    const piece = this.match.builds.pieces.get(e.pieceId);
    this.endEdit();
    if (!piece) return;
    const result = selectionToEdit(piece.type, piece.editMask, e.selection, e.path);
    if (!result) {
      if (e.changed) this.notice?.(piece.type === 'ramp' ? 'Drag across the ramp in the direction it should rise' : "That edit isn't possible");
      return;
    }
    if (result.mask === piece.editMask && (piece.type !== 'ramp' || result.rampDir === piece.rampDir)) return;
    this.adapter.sendAction({ type: 'edit', pieceId: piece.id, mask: result.mask, rampDir: result.rampDir });
  }

  resetEdit(): void {
    const e = this.edit;
    if (!e) return;
    this.adapter.sendAction({ type: 'resetEdit', pieceId: e.pieceId });
    if (this.settings.confirmResetOnRelease) this.endEdit();
    else {
      e.selection.clear();
      e.path = [];
      e.initial.clear();
      e.changed = false;
    }
  }

  cancelEdit(): void {
    this.endEdit();
  }

  private endEdit(): void {
    this.edit = null;
    this.human.editingPieceId = -1;
    this.view.showEditGrid(null, [], new Set(), -1);
  }

  get editing(): boolean {
    return this.edit !== null;
  }

  get editHeldTime(): number {
    return this.edit ? this.edit.startedAt : 0;
  }

  editChanged(): boolean {
    return !!this.edit?.changed;
  }
}

function rayBox(o: Vector3, d: Vector3, b: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): number {
  let tmin = 0;
  let tmax = 1e9;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < mn[i] || os[i] > mx[i]) return -1;
      continue;
    }
    let t1 = (mn[i] - os[i]) / ds[i];
    let t2 = (mx[i] - os[i]) / ds[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Gap between neighbouring edit tiles (metres). */
const TILE_GAP = 0.07;
/** How far tiles float off the surface toward the viewer. */
const TILE_LIFT = 0.06;

/**
 * A tile over the local rectangle [u0,u1]x[v0,v1] of a surface, draped by
 * sampling `surf` on a small grid. `surf` returns the world point on the
 * surface (already lifted toward the viewer).
 */
function drapeTile(surf: (u: number, v: number) => Vector3, u0: number, u1: number, v0: number, v1: number, viewer: Vector3, n = 4): EditTile {
  u0 += TILE_GAP;
  u1 -= TILE_GAP;
  v0 += TILE_GAP;
  v1 -= TILE_GAP;
  const points: Vector3[] = [];
  for (let r = 0; r <= n; r++) for (let c = 0; c <= n; c++) points.push(surf(u0 + ((u1 - u0) * c) / n, v0 + ((v1 - v0) * r) / n));
  const um = (u0 + u1) / 2;
  const vm = (v0 + v1) / 2;
  const center = surf(um, vm);
  const e = 0.05;
  const du = surf(um + e, vm).sub(surf(um - e, vm));
  const dv = surf(um, vm + e).sub(surf(um, vm - e));
  const normal = new Vector3().crossVectors(du, dv).normalize();
  if (normal.dot(new Vector3().subVectors(viewer, center)) < 0) normal.negate();
  return { points, n, center, normal };
}

/**
 * Surface function for a horizontal-ish piece: height h(u, v) above the cell's
 * min corner; the tile floats just above it, or just below the underside when
 * the viewer is underneath.
 */
function heightSurface(x0: number, z0: number, viewer: Vector3, top: (u: number, v: number) => number, underside: number) {
  return (u: number, v: number) => {
    const y = top(u, v);
    const below = viewer.y < y;
    return new Vector3(x0 + u, below ? y - underside - TILE_LIFT : y + TILE_LIFT, z0 + v);
  };
}

/**
 * Edit tiles draped over the piece surface: 3x3 on walls, 2x2 on floors and
 * cones (following the cone's faces), and the Fortnite ramp grid (corners +
 * strips) along the slope. `path` is the ramp drag in progress, if any.
 */
export function editTiles(piece: BuildPiece, viewer: Vector3, path: number[] | null = null): EditTile[] {
  const g = piece.grid;
  const x0 = g.x * TILE;
  const y0 = g.y * TILE_H;
  const z0 = g.z * TILE;
  const out: EditTile[] = [];
  if (piece.type === 'wall') {
    const alongZ = (piece.rotation & 1) === 0;
    const plane = alongZ ? x0 : z0;
    const side = (alongZ ? viewer.x : viewer.z) < plane ? -1 : 1;
    const off = side * (SLAB / 2 + TILE_LIFT);
    const surf = (u: number, v: number) => (alongZ ? new Vector3(x0 + off, y0 + v, z0 + u) : new Vector3(x0 + u, y0 + v, z0 + off));
    const tw = TILE / 3;
    const th = TILE_H / 3;
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) out.push(drapeTile(surf, col * tw, (col + 1) * tw, row * th, (row + 1) * th, viewer, 1));
    return out;
  }
  if (piece.type === 'ramp') return rampEditTiles(piece, viewer, path);
  // Floors: on the slab. Cones: like Fortnite, a flat 2x2 grid flush with
  // the cone's base (whatever shape the cone is edited into).
  const surf = piece.type === 'cone' ? heightSurface(x0, z0, viewer, () => y0, 0) : heightSurface(x0, z0, viewer, () => y0 + SLAB / 2, SLAB);
  const h = TILE / 2;
  for (let q = 0; q < 4; q++) {
    const u = (q & 1) * h;
    const v = (q >> 1) * h;
    out.push(drapeTile(surf, u, u + h, v, v + h, viewer, 1));
  }
  return out;
}

/** Height of the slope the ramp edit grid lies on (the full slope for a half ramp). */
function rampDisplayHeight(piece: BuildPiece, x: number, z: number): number | null {
  const mask = piece.editMask & RAMP_SPIRAL ? piece.editMask : FULL_QUAD_MASK;
  return rampSurfaceHeight(piece.grid, piece.rampDir, mask, x, z);
}

/** Cells of the ramp grid that carry the incline arrows for a ramp shape. */
function rampArrows(mask: number, dir: number): Map<number, number> {
  const out = new Map<number, number>();
  // Strips whose thin side runs along the incline: 3 & 5 for Z, 1 & 7 for X.
  const strips = (d: number) => ((d & 1) === 0 ? [3, 5] : [1, 7]);
  if (mask & RAMP_SPIRAL) {
    const [a, b] = strips(dir);
    // Arrow a sits on the first flight if its side of the ramp is that half.
    const firstHasA = rampCellActive(mask & FULL_QUAD_MASK, a);
    out.set(firstHasA ? a : b, dir & 3);
    out.set(firstHasA ? b : a, (dir + 2) & 3);
    return out;
  }
  for (const c of strips(dir)) if (rampCellActive(mask, c)) out.set(c, dir & 3);
  return out;
}

function rampEditTiles(piece: BuildPiece, viewer: Vector3, path: number[] | null): EditTile[] {
  const g = piece.grid;
  const x0 = g.x * TILE;
  const z0 = g.z * TILE;
  const dragging = !!path && path.length > 0;
  // Arrows show the shape the drag would make, or the current one.
  const preview = dragging && path.length > 1 ? selectionToEdit('ramp', piece.editMask, new Set(path), path) : null;
  const arrows = preview ? rampArrows(preview.mask, preview.rampDir!) : dragging ? new Map<number, number>() : rampArrows(piece.editMask, piece.rampDir);
  const surf = heightSurface(x0, z0, viewer, (u, v) => rampDisplayHeight(piece, x0 + u, z0 + v) ?? g.y * TILE_H, SLAB);
  const out: EditTile[] = [];
  for (let cell = 0; cell < 9; cell++) {
    const [ua, ub] = rampCellRange(cell % 3);
    const [va, vb] = rampCellRange(Math.floor(cell / 3));
    const tile = drapeTile(surf, ua, ub, va, vb, viewer, 3);
    const arrowDir = arrows.get(cell);
    tile.hidden = cell === 4;
    tile.gray = dragging ? !path.includes(cell) : !rampCellActive(piece.editMask, cell);
    if (arrowDir !== undefined) tile.arrow = new Vector3(DIR_VECTORS[arrowDir][0], 0, DIR_VECTORS[arrowDir][1]);
    out.push(tile);
  }
  return out;
}
