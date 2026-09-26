/** Global tuning constants shared by simulation and rendering. */

export const GAME_TITLE = 'ROBNITE';

/**
 * Build grid, in Fortnite proportions: a tile is 512 x 384 Unreal units
 * (5.12 m wide, 3.84 m tall), so a ramp climbs at ~36.9° and a player stands
 * a little under half a wall tall.
 */
export const TILE = 5.12;
/** Vertical size of a build cell in world units. */
export const TILE_H = 3.84;
/** Thickness of wall / floor slabs. */
export const SLAB = 0.2;

/** Fixed simulation timestep (seconds). */
export const SIM_DT = 1 / 60;
/** Maximum simulation steps processed per rendered frame (spiral-of-death guard). */
export const MAX_SIM_STEPS = 6;

/**
 * Player capsule. Slightly under half a wall tall (like Fortnite) and slim,
 * so players fit through edited floors above ramps and 1-tile openings.
 */
export const PLAYER_RADIUS = 0.32;
export const PLAYER_HEIGHT = 1.62;
export const PLAYER_CROUCH_HEIGHT = 1.12;
export const EYE_HEIGHT = 1.42;
export const CROUCH_EYE_HEIGHT = 0.95;

export const GRAVITY = 24;
export const JUMP_SPEED = 8.4;
export const RUN_SPEED = 5.5;
export const SPRINT_SPEED = 7.2;
export const CROUCH_SPEED = 2.9;
export const ADS_SPEED = 3.6;
/** Ground acceleration / braking (m/s²): ~0.12 s to full speed, ~0.15 s to stop. */
export const GROUND_ACCEL = 46;
export const GROUND_BRAKE = 38;
/** Air control: acceleration toward the wished direction while airborne (m/s²). */
export const AIR_ACCEL = 10;
export const GROUND_FRICTION = 14;
export const SLIDE_SPEED = 10;
export const SLIDE_TIME = 0.75;
export const STEP_HEIGHT = 0.45;
export const SKYDIVE_FALL_SPEED = 38;
export const SKYDIVE_HORIZONTAL = 16;
export const GLIDE_FALL_SPEED = 9;
export const GLIDE_HORIZONTAL = 12;
export const AUTO_GLIDE_HEIGHT = 45;

/** Fall damage kicks in above this landing speed (m/s). */
export const FALL_DAMAGE_SPEED = 21;
export const FALL_DAMAGE_PER_MS = 7;

export const MAX_HEALTH = 100;
export const MAX_SHIELD = 100;

/** Max distance from player centre to the centre of a build piece. */
export const BUILD_RANGE = 12;
/** Max distance (player → piece centre) the server accepts an edit from. */
export const EDIT_RANGE = TILE * 2.4;
/**
 * Edit reach along the crosshair from the eye, like Fortnite: short with a
 * weapon or pickaxe out (~1 tile), longer with a build piece out (~2 tiles).
 */
export const EDIT_REACH_COMBAT = TILE * 1.15;
export const EDIT_REACH_BUILD = TILE * 1.9;
export const INTERACT_RANGE = 3.2;

export const MATERIAL_CAP = 999;
