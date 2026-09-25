import { Vector3 } from 'three';
import {
  ADS_SPEED,
  AIR_ACCEL,
  AUTO_GLIDE_HEIGHT,
  CROUCH_SPEED,
  GLIDE_FALL_SPEED,
  GLIDE_HORIZONTAL,
  GRAVITY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_SPEED,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  RUN_SPEED,
  SKYDIVE_FALL_SPEED,
  SKYDIVE_HORIZONTAL,
  SLIDE_SPEED,
  SLIDE_TIME,
  SPRINT_SPEED,
} from '../core/constants';
import { bodyBlocked, moveCharacter } from '../physics/character';
import type { CollisionWorld } from '../physics/collision';
import type { Combatant } from './Combatant';

export interface MovementEvents {
  jumped: boolean;
  landed: boolean;
  landingSpeed: number;
  gliderOpened: boolean;
}

const wish = new Vector3();

/**
 * Apply one fixed-step of movement for a combatant from its current input.
 * Shared by humans and bots, so both obey identical physics.
 */
export function stepMovement(c: Combatant, world: CollisionWorld, dt: number, waterLevel: number | null, prevJump: boolean): MovementEvents {
  const ev: MovementEvents = { jumped: false, landed: false, landingSpeed: 0, gliderOpened: false };
  const input = c.input;
  const sin = Math.sin(c.yaw);
  const cos = Math.cos(c.yaw);
  // Forward is -Z at yaw 0; right is +X.
  wish.set(-sin * input.forward + cos * input.right, 0, -cos * input.forward - sin * input.right);
  if (wish.lengthSq() > 1) wish.normalize();

  if (c.air === 'bus') return ev;

  if (c.air === 'skydive' || c.air === 'glide') {
    const gliding = c.air === 'glide';
    const hSpeed = gliding ? GLIDE_HORIZONTAL : SKYDIVE_HORIZONTAL;
    const targetVy = gliding ? -GLIDE_FALL_SPEED : -SKYDIVE_FALL_SPEED * (0.75 + Math.max(0, -input.pitch) * 0.35);
    c.vel.x += (wish.x * hSpeed - c.vel.x) * Math.min(1, dt * 2.5);
    c.vel.z += (wish.z * hSpeed - c.vel.z) * Math.min(1, dt * 2.5);
    c.vel.y += (targetVy - c.vel.y) * Math.min(1, dt * (gliding ? 3 : 1.5));
    const res = moveCharacter(world, c, dt);
    const heightAboveGround = c.pos.y - world.terrainHeight(c.pos.x, c.pos.z);
    if (!gliding && heightAboveGround < AUTO_GLIDE_HEIGHT) {
      c.air = 'glide';
      ev.gliderOpened = true;
    }
    if (c.grounded) {
      c.air = 'none';
      ev.landed = true;
      ev.landingSpeed = 0; // gliders never cause fall damage
      void res;
    }
    return ev;
  }

  // --- Ground / normal airborne movement
  const usingItem = c.useTimer > 0;
  const wantsCrouch = input.crouch && !usingItem;
  // Slide: crouch pressed while sprinting on the ground.
  if (wantsCrouch && !c.crouching && c.sprinting && c.grounded && c.slideTimer <= 0) {
    c.slideTimer = SLIDE_TIME;
    const hv = Math.hypot(c.vel.x, c.vel.z) || 1;
    c.vel.x = (c.vel.x / hv) * SLIDE_SPEED;
    c.vel.z = (c.vel.z / hv) * SLIDE_SPEED;
  }
  if (wantsCrouch) {
    c.crouching = true;
    c.height = PLAYER_CROUCH_HEIGHT;
  } else if (c.crouching) {
    // Stand up only with headroom.
    if (!bodyBlocked(world, c.pos, c.radius - 0.02, PLAYER_HEIGHT)) {
      c.crouching = false;
      c.height = PLAYER_HEIGHT;
      c.slideTimer = 0;
    }
  }

  const canSprint = input.sprint && input.forward > 0.1 && !input.aim && !c.crouching && !usingItem;
  c.sprinting = canSprint && !input.fire;
  let speed = RUN_SPEED;
  if (c.crouching) speed = CROUCH_SPEED;
  else if (input.aim && c.inventory.currentWeapon()) speed = ADS_SPEED;
  else if (c.sprinting) speed = SPRINT_SPEED;
  if (usingItem) speed = 2.4;
  if (c.emoteTimer > 0 && (input.forward !== 0 || input.right !== 0)) c.emoteTimer = 0;
  if (waterLevel !== null && c.pos.y < waterLevel - 0.4) speed *= 0.7;

  if (c.slideTimer > 0) {
    c.slideTimer -= dt;
    // Low-friction slide that slowly bleeds speed; steering is limited.
    const damp = Math.exp(-1.6 * dt);
    c.vel.x = c.vel.x * damp + wish.x * 2 * dt;
    c.vel.z = c.vel.z * damp + wish.z * 2 * dt;
  } else if (c.grounded) {
    const tx = wish.x * speed;
    const tz = wish.z * speed;
    const dx = tx - c.vel.x;
    const dz = tz - c.vel.z;
    const dl = Math.hypot(dx, dz);
    const accel = (wish.lengthSq() > 0.001 ? GROUND_ACCEL : GROUND_FRICTION * Math.max(speed, Math.hypot(c.vel.x, c.vel.z))) * dt;
    if (dl <= accel) {
      c.vel.x = tx;
      c.vel.z = tz;
    } else {
      c.vel.x += (dx / dl) * accel;
      c.vel.z += (dz / dl) * accel;
    }
  } else {
    // Air control
    const tx = wish.x * Math.max(speed, Math.hypot(c.vel.x, c.vel.z));
    const tz = wish.z * Math.max(speed, Math.hypot(c.vel.x, c.vel.z));
    if (wish.lengthSq() > 0.001) {
      c.vel.x += (tx - c.vel.x) * Math.min(1, AIR_ACCEL * dt * 0.25);
      c.vel.z += (tz - c.vel.z) * Math.min(1, AIR_ACCEL * dt * 0.25);
    }
  }

  // Jump (on press, buffered by holding)
  if (input.jump && c.grounded && !usingItem && (!prevJump || c.airTime === 0)) {
    c.vel.y = JUMP_SPEED;
    c.grounded = false;
    c.slideTimer = 0;
    ev.jumped = true;
  }

  c.vel.y -= GRAVITY * dt;
  if (c.vel.y < -55) c.vel.y = -55;
  const wasAir = !c.grounded;
  const res = moveCharacter(world, c, dt);
  if (c.grounded) {
    if (wasAir && c.airTime > 0.12) {
      ev.landed = true;
      ev.landingSpeed = res.landingSpeed;
    }
    c.airTime = 0;
  } else {
    c.airTime += dt;
  }
  return ev;
}
