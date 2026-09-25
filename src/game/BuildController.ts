import { Vector3 } from 'three';
import { TILE, TILE_H } from '../core/constants';
import { computeBuildTarget, type BuildTarget } from '../building/targeting';
import { CONE_HEIGHT } from '../building/grid';
import { removedTiles, selectionToEdit, tileAt, tileCenters } from '../building/edits';
import type { BuildPiece } from '../building/BuildSystem';
import type { Match } from './Match';
import type { NetworkAdapter } from '../networking/NetworkAdapter';
import type { BuildView } from '../rendering/BuildView';
import type { GameplaySettings } from '../settings/settings';

interface EditState {
  pieceId: number;
  selection: Set<number>;
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
    const t = computeBuildTarget(this.match.world.collision, { origin: ray.origin, dir: ray.dir, eye, piece: h.buildPiece, userRotation: h.buildRotation, pieceInfo: this.pieceInfo });
    this.match.builds.check(t, h);
    this.target = t;
    // Aiming at a slot that is already built: show nothing over the real piece.
    this.view.showGhost(t.reason === 'Blocked by existing structure' ? null : t);
  }

  /** Place on click, and keep placing while held whenever the target changes. */
  handleFire(pressed: boolean, held: boolean): void {
    const t = this.target;
    if (!t || !this.human.buildPiece) return;
    if (!held) {
      this.lastPlacedKey = '';
      return;
    }
    if (!t.valid) return;
    if (pressed || t.key !== this.lastPlacedKey) {
      // Send a copy of exactly what the ghost shows.
      this.adapter.sendAction({ type: 'place', target: { ...t, grid: { ...t.grid } } });
      this.lastPlacedKey = t.key;
    }
  }

  // ------------------------------------------------------------ editing

  /** The player's own build piece under the crosshair (within edit range), if any. */
  pieceUnderCrosshair(ray: CameraRay): BuildPiece | null {
    const eye = this.human.eye(new Vector3());
    const t0 = Math.max(0, eye.clone().sub(ray.origin).dot(ray.dir) - 0.25);
    const start = ray.origin.clone().addScaledVector(ray.dir, t0);
    const hit = this.match.world.collision.raycast(start, ray.dir, 12, { includeTerrain: true });
    const piece = this.match.builds.pieceFromCollider(hit?.collider);
    if (!piece) return this.pieceByEditedOpening(start, ray.dir);
    return this.match.builds.canEdit(piece, this.human).valid ? piece : null;
  }

  /**
   * Looking through a fully opened tile of an edited wall should still select
   * it: march the ray through the owner's pieces' bounds.
   */
  private pieceByEditedOpening(start: Vector3, dir: Vector3): BuildPiece | null {
    let best: BuildPiece | null = null;
    let bestT = 9;
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
    this.edit = { pieceId: piece.id, selection: new Set(initial), initial, hover: -1, dragMode: null, changed: false, startedAt: now };
    this.human.editingPieceId = piece.id;
    this.target = null;
    this.view.showGhost(null);
    return true;
  }

  private tileUnderRay(piece: BuildPiece, ray: CameraRay): number {
    const g = piece.grid;
    let t: number;
    if (piece.type === 'wall') {
      if ((piece.rotation & 1) === 0) t = (g.x * TILE - ray.origin.x) / ray.dir.x;
      else t = (g.z * TILE - ray.origin.z) / ray.dir.z;
    } else {
      const y = g.y * TILE_H + (piece.type === 'ramp' ? TILE_H / 2 : piece.type === 'cone' ? CONE_HEIGHT / 2 : 0);
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
    if (fire.pressed && e.hover >= 0) {
      e.dragMode = e.selection.has(e.hover) ? 'remove' : 'add';
    }
    // Apply on the press itself too (a click can press and release within one frame).
    if ((fire.held || fire.pressed) && e.dragMode && e.hover >= 0) {
      const had = e.selection.has(e.hover);
      if (e.dragMode === 'add' && !had) e.selection.add(e.hover);
      if (e.dragMode === 'remove' && had) e.selection.delete(e.hover);
      e.changed = e.changed || had !== e.selection.has(e.hover) || piece.type === 'ramp';
    }
    if (fire.released && e.dragMode) {
      e.dragMode = null;
      if (this.settings.editOnRelease && e.changed) {
        this.commitEdit();
        return false;
      }
    }
    const centers = tileCenters(piece.type, piece.grid, piece.rotation, (x, z) => {
      const c = piece.colliders[0];
      if (c && c.kind === 'surface') return c.height(x, z) ?? piece.grid.y * TILE_H;
      return piece.grid.y * TILE_H;
    }).map((v) => new Vector3(v.x, v.y, v.z));
    this.view.showEditGrid(piece, centers, e.selection, e.hover, viewer);
    return true;
  }

  commitEdit(): void {
    const e = this.edit;
    if (!e) return;
    const piece = this.match.builds.pieces.get(e.pieceId);
    this.endEdit();
    if (!piece) return;
    const result = selectionToEdit(piece.type, piece.editMask, e.selection);
    if (!result) {
      if (e.changed) this.notice?.(piece.type === 'ramp' ? 'Select two tiles along an edge' : 'At least one tile must remain');
      return;
    }
    if (piece.type === 'ramp' ? result.rampDir === piece.rampDir : result.mask === piece.editMask) return;
    this.adapter.sendAction({ type: 'edit', pieceId: piece.id, mask: result.mask, rampDir: result.rampDir });
  }

  resetEdit(): void {
    const e = this.edit;
    if (!e) return;
    this.adapter.sendAction({ type: 'resetEdit', pieceId: e.pieceId });
    if (this.settings.confirmResetOnRelease) this.endEdit();
    else {
      e.selection.clear();
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
    this.view.showEditGrid(null, [], new Set(), -1, new Vector3());
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
