import { Vector3 } from 'three';
import { STEP_HEIGHT } from '../core/constants';
import { makeAABB, type Collider, type CollisionWorld } from './collision';

export interface CharacterBody {
  /** Feet position. */
  pos: Vector3;
  vel: Vector3;
  radius: number;
  height: number;
  grounded: boolean;
}

export interface MoveResult {
  /** Downward speed at the moment of landing (0 if no landing happened). */
  landingSpeed: number;
  hitCeiling: boolean;
  hitWall: boolean;
}

/** How far below a surface's height the feet may be and still be "on top" of it. */
const SURFACE_TOP_TOLERANCE = 0.6;
const SUBSTEP = 0.2;
const SNAP_DOWN = 0.45;

const scratch: Collider[] = [];
const prev = new Vector3();
const qbox = makeAABB(0, 0, 0, 0, 0, 0);

function setBodyBox(p: Vector3, r: number, h: number, pad = 0) {
  qbox.minX = p.x - r - pad;
  qbox.maxX = p.x + r + pad;
  qbox.minZ = p.z - r - pad;
  qbox.maxZ = p.z + r + pad;
  qbox.minY = p.y + 0.01;
  qbox.maxY = p.y + h;
  return qbox;
}

function overlapsXZ(c: Collider, p: Vector3, r: number): boolean {
  const b = c.box;
  return p.x + r > b.minX && p.x - r < b.maxX && p.z + r > b.minZ && p.z - r < b.maxZ;
}

/** True if the character would overlap any solid box at position p. */
export function bodyBlocked(world: CollisionWorld, p: Vector3, r: number, h: number): boolean {
  const list = world.query(setBodyBox(p, r, h), scratch);
  for (const c of list) if (c.kind === 'box') return true;
  return false;
}

/**
 * Kinematic character movement with sub-stepping. Resolves axis-by-axis
 * against boxes (with step-up), one-sided surfaces (ramps/cones), and the
 * terrain heightfield. Deterministic for identical inputs.
 */
export function moveCharacter(world: CollisionWorld, body: CharacterBody, dt: number): MoveResult {
  const result: MoveResult = { landingSpeed: 0, hitCeiling: false, hitWall: false };
  const wasGrounded = body.grounded;
  const { pos, vel, radius: r, height: h } = body;
  const dx = vel.x * dt;
  const dy = vel.y * dt;
  const dz = vel.z * dt;
  const steps = Math.min(16, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / SUBSTEP)));
  let grounded = false;
  for (let s = 0; s < steps; s++) {
    prev.copy(pos);
    pos.x += dx / steps;
    if (resolveHorizontal(world, body, 'x', prev, wasGrounded || grounded)) result.hitWall = true;
    prev.copy(pos);
    pos.z += dz / steps;
    if (resolveHorizontal(world, body, 'z', prev, wasGrounded || grounded)) result.hitWall = true;
    prev.copy(pos);
    pos.y += (vel.y * dt) / steps;
    const v = resolveVertical(world, body, prev, dy);
    if (v.landed) {
      grounded = true;
      if (-vel.y > result.landingSpeed) result.landingSpeed = -vel.y;
      if (vel.y < 0) vel.y = 0;
    }
    if (v.ceiling) {
      result.hitCeiling = true;
      if (vel.y > 0) vel.y = 0;
    }
  }

  // Terrain.
  const th = world.terrainHeight(pos.x, pos.z);
  if (pos.y <= th) {
    if (vel.y < 0 && !wasGrounded && -vel.y > result.landingSpeed) result.landingSpeed = -vel.y;
    pos.y = th;
    if (vel.y < 0) vel.y = 0;
    grounded = true;
  }

  // Ground probe / snap-down so we stick to slopes and ramps while walking.
  if (!grounded && vel.y <= 0) {
    const g = groundBelow(world, pos, r, h, wasGrounded ? SNAP_DOWN : 0.04);
    if (g !== null) {
      pos.y = g;
      grounded = true;
      if (vel.y < 0) vel.y = 0;
    }
  }

  // Map bounds.
  const b = world.bounds;
  if (pos.x < b.minX + r) { pos.x = b.minX + r; vel.x = 0; }
  if (pos.x > b.maxX - r) { pos.x = b.maxX - r; vel.x = 0; }
  if (pos.z < b.minZ + r) { pos.z = b.minZ + r; vel.z = 0; }
  if (pos.z > b.maxZ - r) { pos.z = b.maxZ - r; vel.z = 0; }
  if (pos.y > b.maxY - h) { pos.y = b.maxY - h; if (vel.y > 0) vel.y = 0; }

  body.grounded = grounded;
  return result;
}

function resolveHorizontal(world: CollisionWorld, body: CharacterBody, axis: 'x' | 'z', prevPos: Vector3, canStep: boolean): boolean {
  const { pos, vel, radius: r, height: h } = body;
  let blocked = false;
  const list = world.query(setBodyBox(pos, r, h), scratch).slice();
  for (const c of list) {
    if (c.kind === 'box') {
      const b = c.box;
      if (!(pos.x + r > b.minX && pos.x - r < b.maxX && pos.z + r > b.minZ && pos.z - r < b.maxZ)) continue;
      if (!(pos.y + h > b.minY && pos.y + 0.01 < b.maxY)) continue;
      const rise = b.maxY - pos.y;
      if (canStep && rise > 0 && rise <= STEP_HEIGHT) {
        const raised = new Vector3(pos.x, b.maxY + 0.001, pos.z);
        if (!bodyBlocked(world, raised, r, h)) {
          pos.y = b.maxY + 0.001;
          continue;
        }
      }
      if (axis === 'x') {
        const centre = (b.minX + b.maxX) * 0.5;
        pos.x = prevPos.x < centre ? b.minX - r - 1e-4 : b.maxX + r + 1e-4;
        vel.x = 0;
      } else {
        const centre = (b.minZ + b.maxZ) * 0.5;
        pos.z = prevPos.z < centre ? b.minZ - r - 1e-4 : b.maxZ + r + 1e-4;
        vel.z = 0;
      }
      blocked = true;
    } else {
      const sh = c.height(pos.x, pos.z);
      if (sh === null) continue;
      if (pos.y >= sh - SURFACE_TOP_TOLERANCE) continue; // walking onto it
      if (pos.y + h <= sh - 0.12) continue; // passing underneath
      if (axis === 'x') {
        pos.x = prevPos.x;
        vel.x = 0;
      } else {
        pos.z = prevPos.z;
        vel.z = 0;
      }
      blocked = true;
    }
  }
  return blocked;
}

function resolveVertical(world: CollisionWorld, body: CharacterBody, prevPos: Vector3, dy: number): { landed: boolean; ceiling: boolean } {
  const { pos, radius: r, height: h } = body;
  let landed = false;
  let ceiling = false;
  const minY = Math.min(prevPos.y, pos.y);
  const maxY = Math.max(prevPos.y, pos.y) + h;
  qbox.minX = pos.x - r;
  qbox.maxX = pos.x + r;
  qbox.minZ = pos.z - r;
  qbox.maxZ = pos.z + r;
  qbox.minY = minY - 0.05;
  qbox.maxY = maxY;
  const list = world.query(qbox, scratch).slice();
  for (const c of list) {
    if (c.kind === 'box') {
      const b = c.box;
      if (!overlapsXZ(c, pos, r)) continue;
      if (dy <= 0 && prevPos.y >= b.maxY - 0.03 && pos.y < b.maxY) {
        pos.y = b.maxY;
        landed = true;
      } else if (dy > 0 && prevPos.y + h <= b.minY + 0.03 && pos.y + h > b.minY) {
        pos.y = b.minY - h;
        ceiling = true;
      } else if (pos.y < b.maxY && pos.y + h > b.minY) {
        // Penetrating (spawned or a piece was built around us): pop out upward if shallow.
        if (b.maxY - pos.y < 0.7) {
          pos.y = b.maxY;
          landed = true;
        }
      }
    } else {
      const sh = c.height(pos.x, pos.z);
      if (sh === null) continue;
      const psh = c.height(prevPos.x, prevPos.z) ?? sh;
      const wasAbove = prevPos.y >= psh - SURFACE_TOP_TOLERANCE;
      if (wasAbove) {
        if (pos.y < sh && pos.y > sh - SURFACE_TOP_TOLERANCE - Math.abs(dy)) {
          pos.y = sh;
          landed = true;
        }
      } else if (pos.y + h > sh - 0.12 && prevPos.y + h <= psh - 0.12 + 0.05) {
        pos.y = sh - 0.12 - h;
        ceiling = true;
      }
    }
  }
  return { landed, ceiling };
}

/** Highest support (box top, surface, terrain) within `maxDown` below the feet. */
export function groundBelow(world: CollisionWorld, pos: Vector3, r: number, h: number, maxDown: number): number | null {
  let best: number | null = null;
  const th = world.terrainHeight(pos.x, pos.z);
  if (th <= pos.y + 0.001 && pos.y - th <= maxDown) best = th;
  qbox.minX = pos.x - r;
  qbox.maxX = pos.x + r;
  qbox.minZ = pos.z - r;
  qbox.maxZ = pos.z + r;
  qbox.minY = pos.y - maxDown - 0.01;
  qbox.maxY = pos.y + 0.05;
  const list = world.query(qbox, scratch);
  for (const c of list) {
    let top: number | null;
    if (c.kind === 'box') top = c.box.maxY;
    else top = c.height(pos.x, pos.z);
    if (top === null) continue;
    if (top <= pos.y + 0.02 && pos.y - top <= maxDown) {
      if (best === null || top > best) best = top;
    }
  }
  void h;
  return best;
}
