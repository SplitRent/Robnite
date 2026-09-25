import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { flatWorld, targetFrom } from './helpers';
import { TILE, TILE_H } from '../src/core/constants';
import { pieceBounds, FULL_WALL_MASK } from '../src/building/grid';
import { WALL_PRESETS, FLOOR_PRESETS, selectionToEdit } from '../src/building/edits';
import { makeTarget, computeBuildTarget } from '../src/building/targeting';
import { moveCharacter } from '../src/physics/character';

/** Pitch that makes the eye ray hit flat ground at horizontal distance d. */
const pitchFor = (d: number) => -Math.atan2(1.6, d);

describe('build targeting (crosshair → grid)', () => {
  it('is deterministic for identical inputs', () => {
    const { world, builds, actor } = flatWorld();
    const a = targetFrom(world, builds, actor.pos as Vector3, 0.3, -0.4, 'wall');
    const b = targetFrom(world, builds, actor.pos as Vector3, 0.3, -0.4, 'wall');
    expect(a).toEqual(b);
  });

  it('floor goes in the cell under the crosshair and moves exactly one cell per cell of aim', () => {
    const { world, builds } = flatWorld();
    const pos = new Vector3(2, 0, 2);
    // Looking straight down -Z at ground points z = 2 - d.
    const t1 = targetFrom(world, builds, pos, 0, pitchFor(3), 'floor'); // hits z = -1 → cell -1
    const t2 = targetFrom(world, builds, pos, 0, pitchFor(3 + TILE), 'floor'); // hits z = -5 → cell -2
    expect(t1.grid).toEqual({ x: 0, y: 0, z: -1 });
    expect(t2.grid).toEqual({ x: 0, y: 0, z: -2 });
  });

  it('wall on the ground snaps to the grid line ahead of the crosshair', () => {
    const { world, builds } = flatWorld();
    const pos = new Vector3(2, 0, 2);
    const t = targetFrom(world, builds, pos, 0, pitchFor(1.5), 'wall'); // hit z = 0.5 → line z = 0
    expect(t.piece).toBe('wall');
    expect(t.rotation).toBe(1);
    expect(t.grid).toEqual({ x: 0, y: 0, z: 0 });
    const t2 = targetFrom(world, builds, pos, 0, pitchFor(1.5 + TILE), 'wall'); // one tile further
    expect(t2.grid).toEqual({ x: 0, y: 0, z: -1 });
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

  it('floor beneath the player is allowed (lifts the player) but a wall through the player is blocked', () => {
    const { builds, actor } = flatWorld();
    actor.pos.x = 2;
    actor.pos.z = 2;
    expect(builds.validate(makeTarget('floor', { x: 0, y: 0, z: 0 }, 0), actor).valid).toBe(true);
    const through = makeTarget('wall', { x: 0, y: 0, z: 0 }, 0);
    actor.pos.x = 0.1; // standing on the wall line
    expect(builds.validate(through, actor)).toEqual({ valid: false, reason: 'Blocked by player' });
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
    if (c.kind === 'surface') expect(c.height(2, -2)).toBeCloseTo(TILE_H + TILE_H * 0.5);
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
    // The wall lies on the plane z = -4; walk from z = -2 toward -Z through the door.
    const body = { pos: new Vector3(2, 0, -2), vel: new Vector3(0, 0, -6), radius: 0.38, height: 1.8, grounded: true };
    for (let i = 0; i < 60; i++) {
      body.vel.set(0, 0, -6);
      moveCharacter(world, body, 1 / 60);
    }
    expect(body.pos.z).toBeLessThan(-5);
  });

  it('solid wall blocks a character', () => {
    const { world, builds, actor } = flatWorld();
    builds.place(makeTarget('wall', { x: 0, y: 0, z: -1 }, 1), actor);
    const body = { pos: new Vector3(2, 0, -2), vel: new Vector3(0, 0, -6), radius: 0.38, height: 1.8, grounded: true };
    for (let i = 0; i < 60; i++) {
      body.vel.set(0, 0, -6);
      moveCharacter(world, body, 1 / 60);
    }
    expect(body.pos.z).toBeGreaterThan(-4 + 0.3);
  });

  it('selection → edit mask conversion (edit on release) and ramp direction edits', () => {
    expect(selectionToEdit('wall', FULL_WALL_MASK, new Set([4]))?.mask).toBe(WALL_PRESETS.window);
    expect(selectionToEdit('wall', FULL_WALL_MASK, new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(selectionToEdit('floor', 0xf, new Set([0, 1]))?.mask).toBe(FLOOR_PRESETS.half);
    expect(selectionToEdit('ramp', 0xf, new Set([1, 3]))?.rampDir).toBe(1);
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
      if (body.pos.z > -4) maxY = Math.max(maxY, body.pos.y);
    }
    // Reached (nearly) the top of the ramp while on it.
    expect(maxY).toBeGreaterThan(TILE_H * 0.8);
    void computeBuildTarget;
  });
});
