import { BUILD_RANGE, EDIT_RANGE, TILE_H } from '../core/constants';
import type { EventBus } from '../core/events';
import { aabbOverlap, makeAABB, type AABB, type Collider, type CollisionWorld } from '../physics/collision';
import type { GameEvents } from '../game/events';
import {
  BUILD_START_HEALTH,
  FULL_QUAD_MASK,
  FULL_WALL_MASK,
  MATERIAL_STATS,
  coneHeight,
  floorBoxes,
  pieceBounds,
  pieceCenter,
  rampHeight,
  slotKey,
  wallBoxes,
  type BuildMaterial,
  type BuildPieceType,
  type GridCoordinate,
} from './grid';
import type { BuildTarget } from './targeting';

export interface BuildPiece {
  id: number;
  type: BuildPieceType;
  material: BuildMaterial;
  ownerId: number;
  teamId: number;
  grid: GridCoordinate;
  /** Placement rotation (wall axis / ramp direction / cone orientation). */
  rotation: number;
  key: string;
  health: number;
  maxHealth: number;
  /** 0..1 build progress; health grows with it. */
  progress: number;
  createdAt: number;
  /** Edit mask (wall 9 bits, floor/cone 4 bits). */
  editMask: number;
  /** Current ramp rising direction (edits can change it). */
  rampDir: number;
  colliders: Collider[];
  /** Cached bounds of the full piece. */
  bounds: AABB;
  /** Pieces pre-placed by a mode (practice walls) cannot be damaged. */
  indestructible: boolean;
}

/** The subset of a combatant the build system needs. */
export interface BuildActor {
  id: number;
  teamId: number;
  pos: { x: number; y: number; z: number };
  materials: Record<BuildMaterial, number>;
  buildMaterial: BuildMaterial;
  unlimitedMaterials: boolean;
}

export interface BodyInfo {
  id: number;
  pos: { x: number; y: number; z: number };
  radius: number;
  height: number;
  alive: boolean;
}

export interface Validation {
  valid: boolean;
  reason: string;
}

const COLLAPSE_DELAY = 0.12;
const MAX_SUPPORT_SEARCH = 600;

/**
 * Authoritative grid building: validation, placement, editing, damage,
 * destruction and structural support. Players and bots use this same API.
 */
export class BuildSystem {
  readonly pieces = new Map<number, BuildPiece>();
  private occupancy = new Map<string, number>();
  private nextId = 1;
  private collapseQueue: { id: number; at: number }[] = [];
  time = 0;
  /** Extra test (e.g. zone bounds) — return a reason string to reject. */
  extraRule: ((t: BuildTarget) => string | null) | null = null;

  constructor(
    private world: CollisionWorld,
    private events: EventBus<GameEvents>,
    private bodies: () => Iterable<BodyInfo>,
  ) {}

  get count(): number {
    return this.pieces.size;
  }

  pieceByKey(key: string): BuildPiece | undefined {
    const id = this.occupancy.get(key);
    return id === undefined ? undefined : this.pieces.get(id);
  }

  pieceFromCollider(c: Collider | null | undefined): BuildPiece | undefined {
    if (!c || c.owner !== 'build') return undefined;
    return this.pieces.get(c.ref);
  }

  /** Full validation of a target for an actor. Does not mutate state. */
  validate(target: BuildTarget, actor: BuildActor | null): Validation {
    const { piece, grid, rotation } = target;
    if (this.occupancy.has(target.key)) return { valid: false, reason: 'Blocked by existing structure' };
    // Ramps and cones share the cell volume slot; a key collision handles that.
    const bounds = pieceBounds(piece, grid, rotation);
    const wb = this.world.bounds;
    if (bounds.minX < wb.minX || bounds.maxX > wb.maxX || bounds.minZ < wb.minZ || bounds.maxZ > wb.maxZ || bounds.maxY > wb.maxY) {
      return { valid: false, reason: 'Outside the map' };
    }
    if (actor) {
      const c = pieceCenter(piece, grid, rotation);
      const dx = c.x - actor.pos.x;
      const dy = c.y - (actor.pos.y + 0.9);
      const dz = c.z - actor.pos.z;
      if (dx * dx + dy * dy + dz * dz > BUILD_RANGE * BUILD_RANGE) return { valid: false, reason: 'Out of range' };
      if (!actor.unlimitedMaterials && actor.materials[actor.buildMaterial] < MATERIAL_STATS[actor.buildMaterial].cost) {
        return { valid: false, reason: `Not enough ${actor.buildMaterial}` };
      }
    }
    // Buried in terrain?
    if (this.buriedFraction(piece, grid, rotation) > 0.92) return { valid: false, reason: 'Blocked by terrain' };
    // Players standing in the way (small tolerance so it never feels sticky).
    const blocking = this.bodyBlockReason(piece, grid, rotation);
    if (blocking) return { valid: false, reason: blocking };
    // Static world geometry.
    const shrunk = shrink(bounds, piece === 'wall' || piece === 'floor' ? 0.06 : 0.35);
    const hits = this.world.query(shrunk);
    for (const c of hits) {
      if (c.owner === 'static' || c.owner === 'door' || c.owner === 'bound') return { valid: false, reason: 'Blocked by world' };
    }
    if (this.extraRule) {
      const r = this.extraRule(target);
      if (r) return { valid: false, reason: r };
    }
    if (!this.isSupportedPlacement(piece, grid, rotation)) return { valid: false, reason: 'No support' };
    return { valid: true, reason: '' };
  }

  /** Validate a target in-place (updates target.valid / reason). */
  check(target: BuildTarget, actor: BuildActor | null): BuildTarget {
    const v = this.validate(target, actor);
    target.valid = v.valid;
    target.reason = v.reason;
    return target;
  }

  /**
   * Place exactly the given target. The preview target is the contract: the
   * piece is created at target.grid / target.rotation or not at all.
   */
  place(target: BuildTarget, actor: BuildActor | null, opts: { material?: BuildMaterial; indestructible?: boolean; ownerId?: number } = {}): BuildPiece | null {
    const v = this.validate(target, actor);
    if (!v.valid) return null;
    const material = opts.material ?? actor?.buildMaterial ?? 'wood';
    const stats = MATERIAL_STATS[material];
    if (actor && !actor.unlimitedMaterials) actor.materials[material] -= stats.cost;
    const piece: BuildPiece = {
      id: this.nextId++,
      type: target.piece,
      material,
      ownerId: opts.ownerId ?? actor?.id ?? -1,
      teamId: actor?.teamId ?? -1,
      grid: { ...target.grid },
      rotation: target.rotation,
      key: slotKey(target.piece, target.grid, target.rotation),
      health: stats.maxHealth * BUILD_START_HEALTH,
      maxHealth: stats.maxHealth,
      progress: 0,
      createdAt: this.time,
      editMask: target.piece === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK,
      rampDir: target.rotation & 3,
      colliders: [],
      bounds: pieceBounds(target.piece, target.grid, target.rotation),
      indestructible: !!opts.indestructible,
    };
    if (opts.indestructible) {
      piece.health = piece.maxHealth;
      piece.progress = 1;
    }
    this.pieces.set(piece.id, piece);
    this.occupancy.set(piece.key, piece.id);
    this.rebuildColliders(piece);
    this.events.emit('BUILD_PLACED', { piece });
    return piece;
  }

  /** (Re)create colliders to match the piece's current edit state. */
  private rebuildColliders(piece: BuildPiece): void {
    for (const c of piece.colliders) this.world.remove(c);
    piece.colliders = [];
    const mat = piece.material;
    const g = piece.grid;
    switch (piece.type) {
      case 'wall':
        for (const b of wallBoxes(g, piece.rotation, piece.editMask)) piece.colliders.push(this.world.addBox(b, 'build', piece.id, mat));
        break;
      case 'floor':
        for (const b of floorBoxes(g, piece.editMask)) piece.colliders.push(this.world.addBox(b, 'build', piece.id, mat));
        break;
      case 'ramp': {
        const dir = piece.rampDir;
        piece.colliders.push(this.world.addSurface(piece.bounds, (x, z) => rampHeight(g, dir, x, z), 'build', piece.id, mat));
        break;
      }
      case 'cone': {
        const mask = piece.editMask;
        piece.colliders.push(this.world.addSurface(piece.bounds, (x, z) => coneHeight(g, mask, x, z), 'build', piece.id, mat));
        break;
      }
    }
  }

  canEdit(piece: BuildPiece, actor: BuildActor): Validation {
    if (piece.ownerId !== actor.id) return { valid: false, reason: 'You can only edit your own builds' };
    const c = pieceCenter(piece.type, piece.grid, piece.rotation);
    const dx = c.x - actor.pos.x;
    const dy = c.y - (actor.pos.y + 0.9);
    const dz = c.z - actor.pos.z;
    if (dx * dx + dy * dy + dz * dz > EDIT_RANGE * EDIT_RANGE) return { valid: false, reason: 'Too far to edit' };
    return { valid: true, reason: '' };
  }

  /** Apply an edit. Collision switches instantly to the edited shape. */
  applyEdit(pieceId: number, actor: BuildActor | null, mask: number, rampDir?: number): boolean {
    const piece = this.pieces.get(pieceId);
    if (!piece) return false;
    if (actor && !this.canEdit(piece, actor).valid) return false;
    if (piece.type === 'ramp') {
      if (rampDir === undefined) return false;
      piece.rampDir = rampDir & 3;
    } else {
      if (mask === 0) return false;
      piece.editMask = mask & (piece.type === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK);
    }
    this.rebuildColliders(piece);
    this.events.emit('BUILD_EDITED', { piece, byId: actor?.id ?? -1 });
    return true;
  }

  resetEdit(pieceId: number, actor: BuildActor | null): boolean {
    const piece = this.pieces.get(pieceId);
    if (!piece) return false;
    if (actor && !this.canEdit(piece, actor).valid) return false;
    piece.editMask = piece.type === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK;
    piece.rampDir = piece.rotation & 3;
    this.rebuildColliders(piece);
    this.events.emit('BUILD_EDIT_RESET', { piece, byId: actor?.id ?? -1 });
    return true;
  }

  isEdited(piece: BuildPiece): boolean {
    if (piece.type === 'ramp') return piece.rampDir !== (piece.rotation & 3);
    return piece.editMask !== (piece.type === 'wall' ? FULL_WALL_MASK : FULL_QUAD_MASK);
  }

  damage(pieceId: number, amount: number, attackerId: number, point: { x: number; y: number; z: number } | null = null): void {
    const piece = this.pieces.get(pieceId);
    if (!piece || piece.indestructible) return;
    piece.health -= amount;
    this.events.emit('BUILD_DAMAGED', { piece, amount, attackerId, point });
    if (piece.health <= 0) this.destroy(pieceId, 'damage');
  }

  destroy(pieceId: number, reason: 'damage' | 'collapse' | 'reset'): void {
    const piece = this.pieces.get(pieceId);
    if (!piece) return;
    for (const c of piece.colliders) this.world.remove(c);
    piece.colliders = [];
    this.pieces.delete(pieceId);
    this.occupancy.delete(piece.key);
    this.events.emit('BUILD_DESTROYED', { piece, reason });
    if (reason !== 'reset') this.checkSupportAround(piece);
  }

  /** Remove every piece (freebuild reset, round reset). */
  resetAll(keepIndestructible = false): void {
    for (const id of [...this.pieces.keys()]) {
      const p = this.pieces.get(id)!;
      if (keepIndestructible && p.indestructible) {
        this.resetEdit(id, null);
        continue;
      }
      this.destroy(id, 'reset');
    }
    this.collapseQueue.length = 0;
  }

  update(dt: number): void {
    this.time += dt;
    for (const p of this.pieces.values()) {
      if (p.progress < 1) {
        const stats = MATERIAL_STATS[p.material];
        const prevProgress = p.progress;
        p.progress = Math.min(1, p.progress + dt / stats.buildTime);
        p.health = Math.min(p.maxHealth, p.health + (p.progress - prevProgress) * p.maxHealth * (1 - BUILD_START_HEALTH));
      }
    }
    if (this.collapseQueue.length) {
      const due = this.collapseQueue.filter((c) => c.at <= this.time);
      if (due.length) {
        this.collapseQueue = this.collapseQueue.filter((c) => c.at > this.time);
        for (const c of due) this.destroy(c.id, 'collapse');
      }
    }
  }

  // ---------------------------------------------------------------- support

  private buriedFraction(piece: BuildPieceType, g: GridCoordinate, rotation: number): number {
    const b = pieceBounds(piece, g, rotation);
    const pts = samplePoints(b);
    let buried = 0;
    const top = piece === 'floor' ? b.maxY : piece === 'wall' ? b.maxY - 0.25 : b.minY + TILE_H * 0.4;
    for (const [x, z] of pts) if (this.world.terrainHeight(x, z) > top) buried++;
    return buried / pts.length;
  }

  private bodyBlockReason(piece: BuildPieceType, g: GridCoordinate, rotation: number): string | null {
    const bounds = pieceBounds(piece, g, rotation);
    for (const body of this.bodies()) {
      if (!body.alive) continue;
      const tol = 0.12;
      const bb = makeAABB(
        body.pos.x - body.radius + tol,
        body.pos.y + 0.05,
        body.pos.z - body.radius + tol,
        body.pos.x + body.radius - tol,
        body.pos.y + body.height - tol,
        body.pos.z + body.radius - tol,
      );
      if (piece === 'wall') {
        if (aabbOverlap(bounds, bb)) return 'Blocked by player';
      } else if (piece === 'floor') {
        // A floor at (or just above) the feet lifts the player; one through the torso is blocked.
        const fy = g.y * TILE_H;
        if (aabbOverlap(bounds, bb) && fy > body.pos.y + 0.6) return 'Blocked by player';
      }
      // Ramps and cones lift players standing in them.
    }
    return null;
  }

  /** True if a piece at this slot would rest on ground, world geometry or another build. */
  private isSupportedPlacement(piece: BuildPieceType, g: GridCoordinate, rotation: number): boolean {
    const b = pieceBounds(piece, g, rotation);
    if (this.touchesGround(piece, b)) return true;
    const q = expand(b, 0.06);
    for (const c of this.world.query(q)) {
      if (c.owner === 'build' || c.owner === 'static') return true;
    }
    return false;
  }

  private touchesGround(piece: BuildPieceType, b: AABB): boolean {
    const bottom = piece === 'floor' ? b.minY : b.minY;
    for (const [x, z] of samplePoints(b)) {
      if (this.world.terrainHeight(x, z) >= bottom - 0.3) return true;
    }
    return false;
  }

  private isGrounded(p: BuildPiece): boolean {
    if (this.touchesGround(p.type, p.bounds)) return true;
    for (const c of this.world.query(expand(p.bounds, 0.06))) if (c.owner === 'static') return true;
    return false;
  }

  neighbours(p: BuildPiece): BuildPiece[] {
    const out: BuildPiece[] = [];
    const seen = new Set<number>();
    for (const c of this.world.query(expand(p.bounds, 0.06))) {
      if (c.owner !== 'build' || c.ref === p.id || seen.has(c.ref)) continue;
      seen.add(c.ref);
      const n = this.pieces.get(c.ref);
      if (n) out.push(n);
    }
    return out;
  }

  /**
   * After a piece is removed, every neighbouring structure must still reach
   * the ground through connected pieces; otherwise it collapses.
   */
  private checkSupportAround(removed: BuildPiece): void {
    // Neighbours of the removed piece, found via its (now empty) bounds.
    const starts: BuildPiece[] = [];
    const seen = new Set<number>();
    for (const c of this.world.query(expand(removed.bounds, 0.06))) {
      if (c.owner !== 'build' || seen.has(c.ref)) continue;
      seen.add(c.ref);
      const p = this.pieces.get(c.ref);
      if (p) starts.push(p);
    }
    const settled = new Set<number>();
    for (const s of starts) {
      if (settled.has(s.id)) continue;
      const visited = new Map<number, BuildPiece>();
      const queue: BuildPiece[] = [s];
      visited.set(s.id, s);
      let grounded = false;
      while (queue.length && visited.size < MAX_SUPPORT_SEARCH) {
        const cur = queue.shift()!;
        if (cur.indestructible || this.isGrounded(cur)) {
          grounded = true;
          break;
        }
        for (const n of this.neighbours(cur)) {
          if (!visited.has(n.id) && !this.collapseQueue.some((q) => q.id === n.id)) {
            visited.set(n.id, n);
            queue.push(n);
          }
        }
      }
      if (visited.size >= MAX_SUPPORT_SEARCH) grounded = true; // too big to evaluate — keep it
      for (const id of visited.keys()) settled.add(id);
      if (!grounded) {
        let i = 0;
        for (const id of visited.keys()) {
          this.collapseQueue.push({ id, at: this.time + COLLAPSE_DELAY + Math.min(0.5, i * 0.02) });
          i++;
        }
      }
    }
  }
}

function shrink(b: AABB, s: number): AABB {
  return makeAABB(b.minX + s, b.minY + s, b.minZ + s, b.maxX - s, b.maxY - s, b.maxZ - s);
}

function expand(b: AABB, s: number): AABB {
  return makeAABB(b.minX - s, b.minY - s, b.minZ - s, b.maxX + s, b.maxY + s, b.maxZ + s);
}

function samplePoints(b: AABB): [number, number][] {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  return [
    [b.minX + 0.1, b.minZ + 0.1],
    [b.maxX - 0.1, b.minZ + 0.1],
    [b.minX + 0.1, b.maxZ - 0.1],
    [b.maxX - 0.1, b.maxZ - 0.1],
    [cx, cz],
  ];
}

