import { Vector3 } from 'three';
import { TILE, TILE_H } from '../core/constants';
import { computeBuildTarget, type BuildTarget } from '../building/targeting';
import { CONE_HEIGHT, DIR_VECTORS } from '../building/grid';
import { removedTiles, selectionToEdit, tileAt } from '../building/edits';
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
    if ((piece.type === 'ramp' || piece.type === 'cone') && col && col.kind === 'surface') {
      // Hit the actual slope so the hovered tile is the one drawn under the crosshair.
      const st = raySurface(ray.origin, ray.dir, col, 40, new Vector3());
      if (st >= 0) {
        const hp = ray.origin.clone().addScaledVector(ray.dir, st);
        return tileAt(piece.type, g, piece.rotation, hp);
      }
    }
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
    this.view.showEditGrid(piece, editTiles(piece, viewer), e.selection, e.hover);
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
      if (e.changed) this.notice?.(piece.type === 'ramp' ? 'Drag across the ramp in the direction it should rise' : 'At least one tile must remain');
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

/**
 * Edit tiles laid on the piece surface: 3x3 on walls, 2x2 on floors, cones
 * and ramps (tilted along the slope). Normals face the viewer.
 */
export function editTiles(piece: BuildPiece, viewer: Vector3): EditTile[] {
  const g = piece.grid;
  const x0 = g.x * TILE;
  const y0 = g.y * TILE_H;
  const z0 = g.z * TILE;
  const out: EditTile[] = [];
  const up = new Vector3(0, 1, 0);
  if (piece.type === 'wall') {
    const alongZ = (piece.rotation & 1) === 0;
    const axisX = alongZ ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
    let normal = alongZ ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    const planeCoord = alongZ ? x0 : z0;
    if ((alongZ ? viewer.x : viewer.z) < planeCoord) normal = normal.negate();
    const ax = axisX.clone();
    // keep a right-handed basis: axisX × axisY = normal
    if (new Vector3().crossVectors(ax, up).dot(normal) < 0) ax.negate();
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const along = (col + 0.5) * (TILE / 3);
        const center = alongZ ? new Vector3(x0, y0 + (row + 0.5) * (TILE_H / 3), z0 + along) : new Vector3(x0 + along, y0 + (row + 0.5) * (TILE_H / 3), z0);
        out.push({ center, axisX: ax, axisY: up, normal, width: TILE / 3, height: TILE_H / 3 });
      }
    }
    return out;
  }
  if (piece.type === 'ramp') {
    const [dx, dz] = DIR_VECTORS[piece.rampDir & 3];
    const d = new Vector3(dx, 0, dz);
    const axisY = d.clone().multiplyScalar(TILE).addScaledVector(up, TILE_H).normalize();
    let normal = up.clone().multiplyScalar(TILE).addScaledVector(d, -TILE_H).normalize();
    let axisX = new Vector3().crossVectors(axisY, normal);
    const slopeLen = Math.hypot(TILE, TILE_H) / 2;
    for (let q = 0; q < 4; q++) {
      const cx = x0 + ((q & 1) + 0.5) * (TILE / 2);
      const cz = z0 + ((q >> 1) + 0.5) * (TILE / 2);
      const t = (cx - x0) / TILE * dx + (cz - z0) / TILE * dz;
      const frac = dx + dz > 0 ? t : 1 + t;
      out.push({ center: new Vector3(cx, y0 + frac * TILE_H, cz), axisX, axisY, normal, width: TILE / 2, height: slopeLen });
    }
    if (viewer.y < out[0].center.y - 1) {
      normal = normal.clone().negate();
      axisX = axisX.clone().negate();
      for (const tile of out) {
        tile.normal = normal;
        tile.axisX = axisX;
      }
    }
    return out;
  }
  // Floors and cones: flat 2x2 (cone tiles sit at the quadrant's mid height).
  const baseY = piece.type === 'cone' ? y0 + CONE_HEIGHT * 0.5 : y0;
  const below = viewer.y < baseY;
  const normal = below ? new Vector3(0, -1, 0) : up.clone();
  const axisX = new Vector3(1, 0, 0);
  const axisY = below ? new Vector3(0, 0, 1) : new Vector3(0, 0, -1);
  for (let q = 0; q < 4; q++) {
    const center = new Vector3(x0 + ((q & 1) + 0.5) * (TILE / 2), baseY, z0 + ((q >> 1) + 0.5) * (TILE / 2));
    out.push({ center, axisX, axisY, normal, width: TILE / 2, height: TILE / 2 });
  }
  return out;
}
