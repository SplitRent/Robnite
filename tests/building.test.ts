import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { flatWorld, targetFrom } from './helpers';
import { EYE_HEIGHT, TILE, TILE_H } from '../src/core/constants';
import { coneHeight, pieceBounds, FULL_WALL_MASK, RAMP_SPIRAL, rampSurfaceHeight, wallBoxes, wallTriangleCorner } from '../src/building/grid';
import { WALL_PRESETS, FLOOR_PRESETS, selectionToEdit } from '../src/building/edits';
import { makeTarget, computeBuildTarget } from '../src/building/targeting';
import { moveCharacter } from '../src/physics/character';

/** Pitch that makes the eye ray hit flat ground at horizontal distance d. */
const pitchFor = (d: number) => -Math.atan2(EYE_HEIGHT, d);

describe('build targeting (crosshair → grid)', () => {
  it('is deterministic for identical inputs', () => {
    const { world, builds, actor } = flatWorld();
    const a = targetFrom(world, builds, actor.pos as Vector3, 0.3, -0.4, 'wall');
    const b = targetFrom(world, builds, actor.pos as Vector3, 0.3, -0.4, 'wall');
    expect(a).toEqual(b);
  });

  it('floor goes in the cell under the crosshair, never further than the neighbouring cell', () => {
    const { world, builds } = flatWorld();
    const pos = new Vector3(2, 0, 2);
    // Looking down -Z at ground points z = 2 - d.
    const t1 = targetFrom(world, builds, pos, 0, pitchFor(3), 'floor'); // hits z = -1 → cell -1
    const t2 = targetFrom(world, builds, pos, 0, pitchFor(3 + TILE), 'floor'); // far away → still the next cell
    const under = targetFrom(world, builds, pos, 0, -1.5, 'floor'); // straight down → own cell
    expect(t1.grid).toEqual({ x: 0, y: 0, z: -1 });
    expect(t2.grid).toEqual({ x: 0, y: 0, z: -1 });
    expect(under.grid).toEqual({ x: 0, y: 0, z: 0 });
    // Looking up builds the floor above (a roof), not one far away.
    expect(targetFrom(world, builds, pos, 0, 0.8, 'floor').grid.y).toBe(1);
  });

  it('wall goes on the nearest grid line in front of the player, wherever the crosshair lands', () => {
    const { world, builds } = flatWorld();
    const pos = new Vector3(2, 0, 2);
    const t = targetFrom(world, builds, pos, 0, -0.1, 'wall');
    expect(t.piece).toBe('wall');
    expect(t.rotation).toBe(1);
    expect(t.grid).toEqual({ x: 0, y: 0, z: 0 });
    // Looking +X builds on the cell's +X line; looking up puts it one level higher.
    expect(targetFrom(world, builds, pos, -Math.PI / 2, 0, 'wall').grid).toEqual({ x: 1, y: 0, z: 0 });
    expect(targetFrom(world, builds, pos, 0, 0.9, 'wall').grid).toEqual({ x: 0, y: 1, z: 0 });
    // Standing right on a line: the next line is used instead of building through the player.
    expect(targetFrom(world, builds, new Vector3(2, 0, 0.2), 0, -0.1, 'wall').grid).toEqual({ x: 0, y: 0, z: -1 });
    // Far from the line, looking down still builds on the nearest line.
    expect(targetFrom(world, builds, new Vector3(2, 0, 4.6), 0, pitchFor(3), 'wall').grid).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('high wall: within half a tile of the line and looking down > 15° skips to the far line', () => {
    const { world, builds } = flatWorld();
    const pos = new Vector3(2, 0, 2); // 2 m from line z = 0
    expect(targetFrom(world, builds, pos, 0, -0.2, 'wall').grid).toEqual({ x: 0, y: 0, z: 0 }); // ~11° down
    expect(targetFrom(world, builds, pos, 0, -0.4, 'wall').grid).toEqual({ x: 0, y: 0, z: -1 }); // ~23° down
  });

  it('preview and placement are identical: the placed piece occupies the previewed bounds', () => {
    const { world, builds, actor } = flatWorld();
    for (const piece of ['wall', 'floor', 'ramp', 'cone'] as const) {
      const t = targetFrom(world, builds, actor.pos as Vector3, 0.2, pitchFor(6), piece);
      builds.check(t, actor);
      expect(t.valid, `${piece}: ${t.reason}`).toBe(true);
      const placed = builds.place(t, actor)!;
      expect(placed).not.toBeNull();
      expect(placed.grid).toEqual(t.grid);
      expect(placed.rotation).toBe(t.rotation);
      expect(placed.key).toBe(t.key);
      const b = pieceBounds(t.piece, t.grid, t.rotation);
      const cb = placed.colliders.map((c) => c.box);
      const minX = Math.min(...cb.map((x) => x.minX));
      const maxX = Math.max(...cb.map((x) => x.maxX));
      expect(minX).toBeCloseTo(b.minX);
      expect(maxX).toBeCloseTo(b.maxX);
      builds.destroy(placed.id, 'reset');
    }
  });

  it('attaches a new wall beside an existing wall and rejects overlapping placement', () => {
    const { builds, actor } = flatWorld();
    const w1 = builds.place(makeTarget('wall', { x: 0, y: 0, z: 0 }, 1), actor)!;
    expect(w1).not.toBeNull();
    const dup = makeTarget('wall', { x: 0, y: 0, z: 0 }, 1);
    expect(builds.validate(dup, actor)).toEqual({ valid: false, reason: 'Blocked by existing structure' });
    const beside = makeTarget('wall', { x: 1, y: 0, z: 0 }, 1);
    expect(builds.validate(beside, actor).valid).toBe(true);
  });

  it('aiming at an existing wall targets that wall slot (occupied) and aiming above it stacks a wall', () => {
    const { world, builds, actor } = flatWorld();
    builds.place(makeTarget('wall', { x: 0, y: 0, z: 0 }, 1), actor);
    const pos = new Vector3(2, 0, 2);
    const t = targetFrom(world, builds, pos, 0, 0, 'wall'); // straight at the wall face
    expect(t.grid).toEqual({ x: 0, y: 0, z: 0 });
    expect(builds.validate(t, actor).valid).toBe(false);
  });

  it('a floor at the feet lifts the player; a wall through the player spawns phased until they leave', () => {
    const { world, builds, actor } = flatWorld();
    Object.assign(actor.pos, { x: 2, y: 0, z: 2 });
    const floor = builds.place(makeTarget('floor', { x: 0, y: 0, z: 0 }, 0), actor)!;
    expect(floor.phased).toBe(false);
    expect(actor.pos.y).toBeGreaterThan(0.05); // pushed up on top of it
    // A wall built through the player is placed, but phased (no collision).
    Object.assign(actor.pos, { x: 0.1, y: 0, z: 2 });
    const wall = builds.place(makeTarget('wall', { x: 0, y: 0, z: 0 }, 0), actor)!;
    expect(wall).not.toBeNull();
    expect(wall.phased).toBe(true);
    expect(world.raycast(new Vector3(-2, 1, 2), new Vector3(1, 0, 0), 4, { includeTerrain: false })?.collider?.ref).not.toBe(wall.id);
    builds.update(1 / 60);
    expect(wall.phased).toBe(true); // still inside it
    // Once the player steps out it turns solid.
    actor.pos.x = 1.5;
    builds.update(1 / 60);
    expect(wall.phased).toBe(false);
    expect(world.raycast(new Vector3(-2, 1, 2), new Vector3(1, 0, 0), 4, { includeTerrain: false })?.collider?.ref).toBe(wall.id);
  });

  it('ramp direction follows the look direction and rotates with R', () => {
    const { world, builds } = flatWorld();
    const pos = new Vector3(2, 0, 2);
    expect(targetFrom(world, builds, pos, 0, pitchFor(4), 'ramp').rotation).toBe(0); // looking -Z → rises toward -Z
    expect(targetFrom(world, builds, pos, -Math.PI / 2, pitchFor(4), 'ramp').rotation).toBe(1); // looking +X
    expect(targetFrom(world, builds, pos, 0, pitchFor(4), 'ramp', 1).rotation).toBe(1);
    expect(targetFrom(world, builds, pos, 0, pitchFor(4), 'ramp', 2).rotation).toBe(2);
  });

  it('floor atop a ramp and roof placement', () => {
    const { world, builds, actor } = flatWorld();
    const ramp = builds.place(makeTarget('ramp', { x: 0, y: 0, z: -1 }, 0), actor)!;
    expect(ramp).not.toBeNull();
    const floor = makeTarget('floor', { x: 0, y: 1, z: -1 }, 0);
    expect(builds.validate(floor, actor).valid).toBe(true);
    builds.place(floor, actor);
    const cone = makeTarget('cone', { x: 0, y: 1, z: -1 }, 0);
    expect(builds.validate(cone, actor).valid).toBe(true);
    const placedCone = builds.place(cone, actor)!;
    // The cone surface peaks in the cell centre.
    const c = placedCone.colliders[0];
    expect(c.kind).toBe('surface');
    if (c.kind === 'surface') expect(c.height(TILE / 2, -TILE / 2)).toBeCloseTo(TILE_H + TILE_H * 0.5);
    void world;
  });

  it('continues a ramp chain when aiming at the surface of a ramp', () => {
    const { world, builds, actor } = flatWorld();
    builds.place(makeTarget('ramp', { x: 0, y: 0, z: -1 }, 0), actor);
    // Stand at the bottom of the ramp looking at its surface.
    const pos = new Vector3(2, 0, 1);
    const t = targetFrom(world, builds, pos, 0, -0.05, 'ramp');
    expect(t.grid).toEqual({ x: 0, y: 1, z: -2 });
  });

  it('is invalid out of range', () => {
    const { builds, actor } = flatWorld();
    const far = makeTarget('wall', { x: 10, y: 0, z: 10 }, 0);
    expect(builds.validate(far, actor).reason).toBe('Out of range');
  });

  it('is invalid without materials', () => {
    const { builds, actor } = flatWorld();
    actor.materials.wood = 5;
    expect(builds.validate(makeTarget('wall', { x: 1, y: 0, z: 1 }, 0), actor).reason).toBe('Not enough wood');
  });

  it('floating pieces with no support are rejected', () => {
    const { builds, actor } = flatWorld();
    expect(builds.validate(makeTarget('floor', { x: 0, y: 2, z: 0 }, 0), actor).reason).toBe('No support');
  });
});

describe('editing', () => {
  it('window edit opens collision in the centre and reset closes it', () => {
    const { world, builds, actor } = flatWorld();
    const wall = builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor)!;
    // Ray through the middle tile of the wall.
    const origin = new Vector3(2, TILE_H / 2, 1);
    const dir = new Vector3(0, 0, -1);
    expect(world.raycast(origin, dir, 20, { includeTerrain: false })?.collider?.ref).toBe(wall.id);
    expect(builds.applyEdit(wall.id, actor, WALL_PRESETS.window)).toBe(true);
    expect(world.raycast(origin, dir, 20, { includeTerrain: false })).toBeNull();
    // Edge tile still solid
    expect(world.raycast(new Vector3(0.3, 0.4, 1), dir, 20, { includeTerrain: false })?.collider?.ref).toBe(wall.id);
    builds.resetEdit(wall.id, actor);
    expect(wall.editMask).toBe(FULL_WALL_MASK);
    expect(world.raycast(origin, dir, 20, { includeTerrain: false })?.collider?.ref).toBe(wall.id);
  });

  it('door edit lets a character walk through', () => {
    const { world, builds, actor } = flatWorld();
    const wall = builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor)!;
    builds.applyEdit(wall.id, actor, WALL_PRESETS.door);
    // The wall lies on the plane z = -TILE; walk from z = -2 toward -Z through the door.
    const body = { pos: new Vector3(TILE / 2, 0, -2), vel: new Vector3(0, 0, -6), radius: 0.38, height: 1.8, grounded: true };
    for (let i = 0; i < 60; i++) {
      body.vel.set(0, 0, -6);
      moveCharacter(world, body, 1 / 60);
    }
    expect(body.pos.z).toBeLessThan(-TILE - 1);
  });

  it('solid wall blocks a character', () => {
    const { world, builds, actor } = flatWorld();
    builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor);
    const body = { pos: new Vector3(TILE / 2, 0, -2), vel: new Vector3(0, 0, -6), radius: 0.38, height: 1.8, grounded: true };
    for (let i = 0; i < 60; i++) {
      body.vel.set(0, 0, -6);
      moveCharacter(world, body, 1 / 60);
    }
    expect(body.pos.z).toBeGreaterThan(-TILE + 0.3);
  });

  it('selection → edit mask conversion (edit on release) and ramp direction edits', () => {
    expect(selectionToEdit('wall', FULL_WALL_MASK, new Set([4]))?.mask).toBe(WALL_PRESETS.window);
    expect(selectionToEdit('wall', FULL_WALL_MASK, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(selectionToEdit('floor', 0xf, new Set([0, 1]))?.mask).toBe(FLOOR_PRESETS.half);
    // Edits that would split a wall / floor into separate pieces are rejected.
    expect(selectionToEdit('wall', FULL_WALL_MASK, new Set([3, 4, 5]))).toBeNull(); // middle row: top and bottom apart
    expect(selectionToEdit('floor', 0xf, new Set([1, 2]))).toBeNull(); // diagonal pair
    expect(selectionToEdit('wall', FULL_WALL_MASK, new Set([1, 4]))?.mask).toBe(WALL_PRESETS.door);
    // Ramp grid (iz*3 + ix): corners 0,2,6,8; strips 1,3,5,7; 4 is the hole.
    // The ramp rises toward the last tile the drag touched.
    const ramp = (path: number[]) => selectionToEdit('ramp', 0xf, new Set(path), path);
    expect(ramp([1, 7])).toEqual({ mask: 0xf, rampDir: 2 }); // middle strip → opposite strip: full ramp, +Z
    expect(ramp([7, 1])).toEqual({ mask: 0xf, rampDir: 0 });
    expect(ramp([3, 5])).toEqual({ mask: 0xf, rampDir: 1 });
    expect(ramp([6, 3, 0])).toEqual({ mask: 0b0101, rampDir: 0 }); // up the -X side: half ramp
    expect(ramp([0, 1, 2])).toEqual({ mask: 0b0011, rampDir: 1 }); // along the -Z row: half ramp
    expect(ramp([6, 3, 0, 1, 2, 5, 8])).toEqual({ mask: RAMP_SPIRAL | 0b0101, rampDir: 0 }); // U: spiral stairs
    expect(ramp([0, 8])?.rampDir).toBe(2); // diagonal → full ramp
    expect(ramp([1])).toBeNull();
  });

  it('ramp shapes: half ramps and spiral stairs change the walkable surface', () => {
    const { builds, actor } = flatWorld();
    const g = { x: 0, y: 0, z: -1 };
    const piece = builds.place(makeTarget('ramp', g, 0), actor)!;
    // A half ramp must run along its long side.
    expect(builds.applyEdit(piece.id, actor, 0b0101, 1)).toBe(false);
    expect(builds.applyEdit(piece.id, actor, 0b0101, 0)).toBe(true);
    expect(builds.isEdited(piece)).toBe(true);
    expect(rampSurfaceHeight(g, 0, 0b0101, TILE * 0.75, -TILE / 2)).toBeNull(); // +X half cut away
    expect(rampSurfaceHeight(g, 0, 0b0101, TILE * 0.25, -TILE / 2)).toBeCloseTo(TILE_H / 2);
    // Spiral: -X flight rises toward -Z to mid height, +X flight climbs back to the top.
    const sp = RAMP_SPIRAL | 0b0101;
    expect(rampSurfaceHeight(g, 0, sp, TILE * 0.25, -TILE + 0.01)).toBeCloseTo(TILE_H / 2, 1);
    expect(rampSurfaceHeight(g, 0, sp, TILE * 0.75, -TILE + 0.01)).toBeCloseTo(TILE_H / 2, 1);
    expect(rampSurfaceHeight(g, 0, sp, TILE * 0.75, -0.01)).toBeCloseTo(TILE_H, 1);
    expect(rampSurfaceHeight(g, 0, sp, TILE * 0.25, -0.01)).toBeCloseTo(0, 1);
    expect(builds.applyEdit(piece.id, actor, sp, 0)).toBe(true);
    builds.resetEdit(piece.id, actor);
    expect(builds.isEdited(piece)).toBe(false);
  });

  it('cone edits lift corners to the ceiling instead of cutting the cone', () => {
    const g = { x: 0, y: 0, z: 0 };
    const peak = TILE_H * 0.5;
    // Full cone: pyramid, corners on the floor, centre at the peak.
    expect(coneHeight(g, 0xf, 0.01, 0.01)).toBeCloseTo(0, 1);
    expect(coneHeight(g, 0xf, TILE / 2, TILE / 2)).toBeCloseTo(peak);
    // One tile (quadrant 0) edited: that corner reaches the top of the grid box.
    const one = 0xf & ~1;
    expect(coneHeight(g, one, 0.01, 0.01)).toBeCloseTo(TILE_H, 1);
    expect(coneHeight(g, one, TILE - 0.01, TILE - 0.01)).toBeCloseTo(0, 1);
    // Still solid everywhere — nothing is removed.
    for (const [x, z] of [[0.5, 0.5], [TILE - 0.5, 0.5], [0.5, TILE - 0.5]]) expect(coneHeight(g, one, x, z)).not.toBeNull();
    // Two tiles on one side: a straight ramp from the far edge (floor) to that edge (ceiling).
    const side = 0xf & ~0b0011;
    for (const [x, z] of [[0.3, 0.2], [TILE / 2, TILE / 2], [TILE - 0.4, TILE * 0.8], [1.1, TILE * 0.3]]) {
      expect(coneHeight(g, side, x, z)).toBeCloseTo(TILE_H * (1 - z / TILE), 5);
    }
    // Head room: a player can walk under the lifted side.
    expect(coneHeight(g, side, TILE / 2, 1)!).toBeGreaterThan(1.8 + 0.5);
  });

  it('removing a corner L of wall tiles cuts the wall diagonally', () => {
    const topLeftCut = FULL_WALL_MASK & ~((1 << 6) | (1 << 7) | (1 << 3));
    expect(wallTriangleCorner(topLeftCut)).toBe(2);
    expect(wallTriangleCorner(WALL_PRESETS.window)).toBe(-1);
    const boxes = wallBoxes({ x: 0, y: 0, z: 0 }, 1, topLeftCut);
    // Solid part grows toward the far end (lower-right triangle).
    expect(boxes[0].maxY).toBeLessThan(boxes[boxes.length - 1].maxY);
    expect(boxes[boxes.length - 1].maxY).toBeGreaterThan(TILE_H * 0.9);
  });

  it('only the owner can edit', () => {
    const { builds, actor } = flatWorld();
    const wall = builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor)!;
    const other = { ...actor, id: 99 };
    expect(builds.applyEdit(wall.id, other, WALL_PRESETS.window)).toBe(false);
  });

  it('floor edits remove collision quadrants', () => {
    const { world, builds, actor } = flatWorld();
    const f = builds.place(makeTarget('floor', { x: 0, y: 0, z: -1 }, 0), actor)!;
    builds.applyEdit(f.id, actor, FLOOR_PRESETS.cornerRemoved); // quadrant 0 (x0..2, z-4..-2) removed
    const down = new Vector3(0, -1, 0);
    expect(world.raycast(new Vector3(1, 2, -3), down, 5, { includeTerrain: false })).toBeNull();
    expect(world.raycast(new Vector3(3, 2, -3), down, 5, { includeTerrain: false })?.collider?.ref).toBe(f.id);
  });
});

describe('destruction & support', () => {
  it('damage destroys a piece, removes collision and frees the slot', () => {
    const { world, builds, actor } = flatWorld();
    const t = makeTarget('wall', { x: 0, y: 0, z: -1 }, 1);
    const wall = builds.place(t, actor)!;
    builds.update(5); // fully built
    expect(wall.health).toBe(wall.maxHealth);
    for (let i = 0; i < 4; i++) builds.damage(wall.id, 40, 2);
    expect(builds.pieces.has(wall.id)).toBe(false);
    expect(world.raycast(new Vector3(2, 1.5, 1), new Vector3(0, 0, -1), 20, { includeTerrain: false })).toBeNull();
    // The same slot can be rebuilt and there is no ghost collision.
    expect(builds.validate(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor).valid).toBe(true);
  });

  it('unsupported structures collapse when their support is destroyed', () => {
    const { builds, actor } = flatWorld();
    const wall = builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor)!;
    const floor = builds.place(makeTarget('floor', { x: 0, y: 1, z: -1 }, 0), actor)!;
    expect(floor).not.toBeNull();
    builds.destroy(wall.id, 'damage');
    builds.update(1);
    expect(builds.pieces.has(floor.id)).toBe(false);
  });

  it('structures still connected to the ground survive', () => {
    const { builds, actor } = flatWorld();
    const w1 = builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor)!;
    builds.place(makeTarget('wall', { x: 1, y: 0, z: -1 }, 1), actor);
    const floor = builds.place(makeTarget('floor', { x: 0, y: 1, z: -1 }, 0), actor)!;
    const floor2 = builds.place(makeTarget('floor', { x: 1, y: 1, z: -1 }, 0), actor)!;
    builds.destroy(w1.id, 'damage');
    builds.update(1);
    expect(builds.pieces.has(floor.id)).toBe(true);
    expect(builds.pieces.has(floor2.id)).toBe(true);
  });

  it('a ramp built on a player: knee-deep lifts them up, deeper phases around them', () => {
    const { world, builds, actor } = flatWorld();
    // Near the low end (slope below the knee): pushed up onto the ramp.
    Object.assign(actor.pos, { x: TILE / 2, y: 0, z: -0.8 });
    const low = builds.place(makeTarget('ramp', { x: 0, y: 0, z: -1 }, 0), actor)!;
    expect(low.phased).toBe(false);
    expect(actor.pos.y).toBeGreaterThan(0.3);
    builds.destroy(low.id, 'reset');
    // In the middle (slope at chest height): the ramp spawns phased.
    Object.assign(actor.pos, { x: TILE / 2, y: 0, z: -TILE / 2 });
    const mid = builds.place(makeTarget('ramp', { x: 0, y: 0, z: -1 }, 0), actor)!;
    expect(mid.phased).toBe(true);
    expect(actor.pos.y).toBe(0);
    // The player can walk out through it; it then turns solid and walkable.
    const body = { pos: new Vector3(TILE / 2, 0, -TILE / 2), vel: new Vector3(), radius: 0.38, height: 1.8, grounded: true };
    for (let i = 0; i < 60; i++) {
      body.vel.set(0, body.vel.y - 24 / 60, 5);
      moveCharacter(world, body, 1 / 60);
      Object.assign(actor.pos, body.pos);
      builds.update(1 / 60);
    }
    expect(body.pos.z).toBeGreaterThan(1);
    expect(mid.phased).toBe(false);
  });

  it('dropping through an edited floor into a box lands inside the box, not on a wall top', () => {
    const { world, builds, actor } = flatWorld();
    Object.assign(actor.pos, { x: 60, y: 0, z: 60 });
    // 1x1 box with a floor on top; the floor corner over the box corner is edited out.
    builds.place(makeTarget('wall', { x: 0, y: 0, z: 0 }, 0), null);
    builds.place(makeTarget('wall', { x: 1, y: 0, z: 0 }, 0), null);
    builds.place(makeTarget('wall', { x: 0, y: 0, z: 0 }, 1), null);
    builds.place(makeTarget('wall', { x: 0, y: 0, z: 1 }, 1), null);
    const f = builds.place(makeTarget('floor', { x: 0, y: 1, z: 0 }, 0), null)!;
    builds.applyEdit(f.id, null, 0b1110);
    // Walk from the floor into the hole, toward the box corner.
    for (const [vx, vz, sx, sz] of [[-4, 0, 3.4, 1.2], [0, -4, 1.2, 3.4], [-3, -3, 3.4, 3.4]]) {
      const body = { pos: new Vector3(sx, TILE_H + 0.1, sz), vel: new Vector3(), radius: 0.32, height: 1.62, grounded: true };
      for (let i = 0; i < 120; i++) {
        body.vel.set(vx, body.vel.y - 24 / 60, vz);
        moveCharacter(world, body, 1 / 60);
      }
      expect(body.pos.y).toBeLessThan(0.1);
      for (const c of [body.pos.x, body.pos.z]) {
        expect(c).toBeGreaterThan(0);
        expect(c).toBeLessThan(TILE);
      }
    }
  });

  it('a ramp through a half-edited floor can be walked up and back down', () => {
    const { world, builds, actor } = flatWorld();
    Object.assign(actor.pos, { x: 60, y: 0, z: 60 });
    builds.place(makeTarget('ramp', { x: 0, y: 0, z: -1 }, 0), null); // rises toward -Z
    // Floor above the ramp; the half over the ramp's top end is edited away.
    const f = builds.place(makeTarget('floor', { x: 0, y: 1, z: -1 }, 0), null)!;
    builds.applyEdit(f.id, null, 0b1100);
    builds.place(makeTarget('floor', { x: 0, y: 1, z: -2 }, 0), null); // landing at the top
    const body = { pos: new Vector3(TILE / 2, 0, 0.8), vel: new Vector3(), radius: 0.32, height: 1.62, grounded: true };
    const walk = (vz: number, frames: number) => {
      for (let i = 0; i < frames; i++) {
        body.vel.set(0, body.vel.y - 24 / 60, vz);
        moveCharacter(world, body, 1 / 60);
      }
    };
    walk(-5, 90);
    expect(body.pos.y).toBeGreaterThan(TILE_H - 0.2); // made it up through the hole
    walk(5, 120);
    expect(body.pos.z).toBeGreaterThan(0.3); // and back down to the bottom
    expect(body.pos.y).toBeLessThan(0.2);
  });

  it('ramps are walkable', () => {
    const { world, builds, actor } = flatWorld();
    builds.place(makeTarget('ramp', { x: 0, y: 0, z: -1 }, 0), actor);
    const body = { pos: new Vector3(2, 0, 1), vel: new Vector3(), radius: 0.38, height: 1.8, grounded: true };
    let maxY = 0;
    for (let i = 0; i < 70; i++) {
      body.vel.x = 0;
      body.vel.z = -6;
      body.vel.y -= 28 / 60;
      moveCharacter(world, body, 1 / 60);
      if (body.pos.z > -TILE) maxY = Math.max(maxY, body.pos.y);
    }
    // Reached (nearly) the top of the ramp while on it.
    expect(maxY).toBeGreaterThan(TILE_H * 0.8);
    void computeBuildTarget;
  });
});
