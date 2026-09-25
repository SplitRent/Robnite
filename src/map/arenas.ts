import { TILE } from '../core/constants';
import { ValueNoise2D, Rng } from '../core/rng';
import { smoothstep } from '../core/math';
import { C, MapBuilder, makeTerrain } from './builder';
import type { MapData } from './mapTypes';
import { buildHollowRidge } from './hollowRidge';
import type { MapId } from '../game/matchTypes';

/** DUEL — a clean competitive arena with elevated terrain and cover. */
export function buildDuelArena(): MapData {
  const half = 64;
  const n = new ValueNoise2D('duel');
  const terrain = makeTerrain(half, 2, (x, z) => {
    let h = 2 + n.fbm(x / 30, z / 30, 3) * 1.4;
    // Two small hills off-centre for high-ground play.
    h += 5 * Math.exp(-((x - 18) ** 2 + (z + 14) ** 2) / 180);
    h += 5 * Math.exp(-((x + 18) ** 2 + (z - 14) ** 2) / 180);
    const e = Math.max(Math.abs(x), Math.abs(z)) / half;
    h += smoothstep(0.8, 1, e) * 18;
    return h;
  });
  const b = new MapBuilder(terrain);
  arenaDressing(b, half, 0x5ee7ff);
  // Centre cover: rock pillars and a ruined wall.
  b.rock(0, 0, 2.4, 0.3);
  b.rock(-10, 8, 1.6, 1.2);
  b.rock(10, -8, 1.6, 2.4);
  b.block(-2, b.ground(-2, 14), 14, 8, 2.2, 0.8, C.stone, { material: 'stone' });
  b.block(2, b.ground(2, -14), -14, 8, 2.2, 0.8, C.stone, { material: 'stone' });
  // Spawn pads with barriers (removed when the round goes live).
  for (const [sx, sz] of [[-34, 0], [34, 0]]) {
    b.spawns.push([sx, sz]);
    const g = b.ground(sx, sz);
    b.deco('cyl', [sx, g + 0.05, sz], [3.2, 0.1, 3.2], 0x1f4f63, [0, 0, 0], { segments: 24 });
    b.deco('cyl', [sx, g + 0.11, sz], [3.25, 0.02, 3.25], 0x5ee7ff, [0, 0, 0], { emissive: true, segments: 24 });
    b.deco('cyl', [sx, g + 0.12, sz], [3.0, 0.03, 3.0], 0x1f4f63, [0, 0, 0], { segments: 24 });
    for (const [bx0, bz0, bx1, bz1] of [[-3, -3, 3, -2.8], [-3, 2.8, 3, 3], [-3, -3, -2.8, 3], [2.8, -3, 3, 3]]) {
      b.barriers.push({ min: [sx + bx0, g - 1, sz + bz0], max: [sx + bx1, g + 4, sz + bz1], color: 0x5ee7ff, collide: true, material: 'glass', glass: true });
    }
  }
  return b.finish('duel_arena', 'Neon Proving Ground', half, { fogDensity: 0.006 });
}

/** BOX FIGHT — compact enclosed arena. */
export function buildBoxArena(): MapData {
  const half = 36;
  const terrain = makeTerrain(half, 2, (x, z) => {
    const e = Math.max(Math.abs(x), Math.abs(z)) / half;
    return smoothstep(0.82, 1, e) * 14;
  });
  const b = new MapBuilder(terrain);
  arenaDressing(b, half, 0xff9d2e);
  // Spawns are cell centres so pre-built boxes line up with the grid.
  b.spawns.push([-2 * TILE + TILE / 2, TILE / 2], [2 * TILE + TILE / 2, TILE / 2]);
  return b.finish('box_arena', 'The Crate', half, { fogDensity: 0.008 });
}

/** ZONE WARS — hilly mid-size map with small structures. */
export function buildZoneArena(): MapData {
  const half = 100;
  const n = new ValueNoise2D('zonewar');
  const terrain = makeTerrain(half, 2, (x, z) => {
    let h = 6 + n.fbm(x / 45, z / 45, 4) * 10;
    const e = Math.max(Math.abs(x), Math.abs(z)) / half;
    h += smoothstep(0.78, 1, e) * 30;
    return h;
  });
  const b = new MapBuilder(terrain);
  const rng = new Rng('zonewar-content');
  const hutColors = [0xb3452f, 0x3f5f86, 0x4f6d3d, 0xd9c27a];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const r = 45 + (i % 2) * 15;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    b.house({ x, z, w: 7, d: 7, wallColor: rng.pick([C.cream, C.white, 0x8fb3c9, 0xc98e6b]), roofColor: hutColors[i % 4], doorSides: ['n', 's'] });
    b.spawns.push([x + 8, z + 8]);
  }
  b.spawns.push([0, 0]);
  for (let i = 0; i < 90; i++) {
    const x = rng.range(-half + 15, half - 15);
    const z = rng.range(-half + 15, half - 15);
    if (Math.hypot(x, z) < 12) continue;
    if (rng.chance(0.75)) b.tree(rng.chance(0.6) ? 'pine' : 'oak', x, z, rng.range(0.9, 1.3), rng.range(0, 6));
    else b.rock(x, z, rng.range(1, 2.4), rng.range(0, 6));
  }
  b.rock(0, 0, 3, 0.5);
  for (let i = 0; i < 16; i++) b.lootSpots.push([rng.range(-60, 60), 0, rng.range(-60, 60)]);
  for (const s of b.lootSpots) s[1] = b.ground(s[0], s[2]) + 0.1;
  return b.finish('zone_arena', 'Shifting Hills', half, { fogDensity: 0.004 });
}

/** TRAINING GROUNDS — freebuild / tutorial with practice stations. */
export function buildTrainingGrounds(): MapData {
  const half = 90;
  const terrain = makeTerrain(half, 2, (x, z) => {
    const e = Math.max(Math.abs(x), Math.abs(z)) / half;
    return smoothstep(0.85, 1, e) * 20;
  });
  const b = new MapBuilder(terrain);
  arenaDressing(b, half, 0x3ccf8e);
  b.spawns.push([2, 6]);
  // Station pads & signs. Station centres are aligned to the build grid.
  const stations: [number, number, string][] = [
    [-40, -40, 'WALL PRACTICE'],
    [0, -40, 'RAMP PRACTICE'],
    [40, -40, '90 PRACTICE'],
    [-40, 24, 'EDIT PRACTICE'],
    [0, 40, 'AIM PRACTICE'],
    [40, 24, 'BOX FIGHT PRACTICE'],
  ];
  for (const [x, z, label] of stations) {
    b.deco('box', [x, 0.02, z], [14, 0.04, 14], 0x2a3542);
    // The sign board stands on the pad edge facing the spawn so it is readable on arrival.
    const facing = z < 6 ? 1 : -1;
    const edge = z + facing * 7.6;
    b.deco('box', [x, 0.03, z + facing * 7], [14, 0.05, 0.25], 0x3ccf8e, [0, 0, 0], { emissive: true });
    b.deco('box', [x, 2.6, edge - facing * 0.12], [7.6, 1.6, 0.2], 0x1b2430);
    b.deco('box', [x - 3.4, 0.9, edge - facing * 0.12], [0.2, 1.8, 0.2], 0x3a4656);
    b.deco('box', [x + 3.4, 0.9, edge - facing * 0.12], [0.2, 1.8, 0.2], 0x3a4656);
    b.sign(x, edge, facing > 0 ? 0 : Math.PI, label, 7, 2.6, '#3ccf8e');
  }
  b.pois.push(
    ...stations.map(([x, z, label], i) => ({ id: `station${i}`, name: label, x, z, radius: 10, lootValue: 0 })),
  );
  return b.finish('training_grounds', 'Training Grounds', half, { fogDensity: 0.004 });
}

function arenaDressing(b: MapBuilder, half: number, accent: number): void {
  const rng = new Rng(`arena-${half}`);
  // Floodlight towers in the corners.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (half - 10);
    const z = sz * (half - 10);
    const g = b.ground(x, z);
    b.deco('box', [x, g + 7, z], [0.6, 14, 0.6], C.metalDark);
    b.deco('box', [x, g + 14.2, z], [2.4, 1, 0.6], C.black, [0, Math.atan2(-sx, -sz), 0]);
    b.deco('box', [x - sx * 0.1, g + 14.2, z - sz * 0.1], [2.2, 0.8, 0.1], 0xfffbe8, [0, Math.atan2(-sx, -sz), 0], { emissive: true });
  }
  // Accent strips on the arena border.
  for (let i = -1; i <= 1; i += 2) {
    b.deco('box', [0, b.ground(0, i * (half - 14)) + 0.05, i * (half - 14)], [half * 1.5, 0.08, 0.3], accent, [0, 0, 0], { emissive: true });
  }
  for (let i = 0; i < 18; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = half - rng.range(3, 9);
    b.tree('pine', Math.cos(a) * r, Math.sin(a) * r, rng.range(0.9, 1.4), a);
  }
}

const cache = new Map<MapId, MapData>();

/** Build (and cache) a map by id. Map generation is deterministic. */
export function loadMap(id: MapId): MapData {
  const cached = cache.get(id);
  if (cached) return cached;
  let m: MapData;
  switch (id) {
    case 'hollow_ridge':
      m = buildHollowRidge();
      break;
    case 'duel_arena':
      m = buildDuelArena();
      break;
    case 'box_arena':
      m = buildBoxArena();
      break;
    case 'zone_arena':
      m = buildZoneArena();
      break;
    case 'training_grounds':
      m = buildTrainingGrounds();
      break;
  }
  cache.set(id, m);
  return m;
}
