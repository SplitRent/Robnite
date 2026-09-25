/** Global tuning constants shared by simulation and rendering. */

export const GAME_TITLE = 'ROBNITE';

/** Horizontal size of a build cell in world units (metres). */
export const TILE = 4;
/** Vertical size of a build cell in world units. */
export const TILE_H = 3.2;
/** Thickness of wall / floor slabs. */
export const SLAB = 0.2;

/** Fixed simulation timestep (seconds). */
export const SIM_DT = 1 / 60;
/** Maximum simulation steps processed per rendered frame (spiral-of-death guard). */
export const MAX_SIM_STEPS = 6;

export const PLAYER_RADIUS = 0.38;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.25;
export const EYE_HEIGHT = 1.6;
export const CROUCH_EYE_HEIGHT = 1.1;

export const GRAVITY = 28;
export const JUMP_SPEED = 9.2;
export const RUN_SPEED = 6.0;
export const SPRINT_SPEED = 7.6;
export const CROUCH_SPEED = 3.0;
export const ADS_SPEED = 3.9;
export const GROUND_ACCEL = 70;
export const AIR_ACCEL = 14;
export const GROUND_FRICTION = 14;
export const SLIDE_SPEED = 10;
export const SLIDE_TIME = 0.75;
export const STEP_HEIGHT = 0.5;
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
/** Max distance for entering edit mode on a piece. */
export const EDIT_RANGE = 9;
export const INTERACT_RANGE = 3.2;

export const MATERIAL_CAP = 999;
