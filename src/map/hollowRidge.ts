import { Rng, ValueNoise2D } from '../core/rng';
import { smoothstep } from '../core/math';
import { C, MapBuilder, distToSegment, makeTerrain } from './builder';
import type { MapData, POI } from './mapTypes';

/**
 * HOLLOW RIDGE — the flagship battle royale map.
 * Lore: the valley grew around Skyline Labs, an experimental energy facility.
 * When its containment failed, the unstable "Gridfall" storm began sweeping
 * the region, leaving the towns abandoned.
 */

export const HR_HALF = 220;
const WATER_LEVEL = 1.4;

interface PoiDef extends POI {
  h: number;
}

const POIS: PoiDef[] = [
  { id: 'ridgeway', name: 'Ridgeway Town', x: -95, z: 55, radius: 48, h: 8, lootValue: 0.85 },
  { id: 'ironworks', name: 'Ironworks', x: 100, z: 102, radius: 44, h: 5, lootValue: 0.75 },
  { id: 'pinewater', name: 'Pinewater Lake', x: -88, z: -100, radius: 44, h: 4, lootValue: 0.5 },
  { id: 'quarry', name: 'Old Quarry', x: 105, z: -90, radius: 44, h: 10, lootValue: 0.6 },
  { id: 'skyline', name: 'Skyline Labs', x: 5, z: -15, radius: 34, h: 15, lootValue: 0.95 },
  { id: 'chapel', name: 'Overgrown Chapel', x: -15, z: 150, radius: 22, h: 20, lootValue: 0.45 },
];

const COMPOUNDS = [
  { id: 'farm', x: 60, z: 30, r: 24, h: 9 },
  { id: 'radio', x: -170, z: -25, r: 16, h: 12 },
  { id: 'lookout', x: 45, z: -155, r: 16, h: 9 },
  { id: 'diner', x: 170, z: 20, r: 16, h: 6 },
];

const LAKE = { x: -100, z: -104, r: 34 };
const QUARRY = { x: 105, z: -90, r: 30 };

const ROADS: [number, number][][] = [
  [[-150, 55], [-40, 55], [-10, 20], [5, -15]],
  [[5, -15], [40, 20], [60, 30], [100, 70], [100, 102]],
  [[5, -15], [60, -50], [105, -58], [140, -58]],
  [[-95, 55], [-95, -10], [-75, -60], [-70, -90]],
  [[5, -15], [-5, 60], [-15, 128]],
  [[60, 30], [170, 20]],
  [[-95, -10], [-170, -25]],
  [[60, -50], [45, -155]],
];

export function buildHollowRidge(): MapData {
  const noise = new ValueNoise2D('hollow-ridge-a');
  const noise2 = new ValueNoise2D('hollow-ridge-b');
  const rng = new Rng('hollow-ridge-content');

  const height = (x: number, z: number): number => {
    let h = 9 + noise.fbm(x / 110, z / 110, 4) * 12 + noise2.fbm(x / 34, z / 34, 3) * 2.2;
    // The ridge the map is named after: a long spine running SW → NE.
    const ridgeD = distToSegment(x, z, -170, 130, -40, 110);
    h += Math.exp(-(ridgeD * ridgeD) / (2 * 20 * 20)) * 16;
    const ridge2 = distToSegment(x, z, 150, -170, 180, 60);
    h += Math.exp(-(ridge2 * ridge2) / (2 * 18 * 18)) * 12;
    // Mountain rim at the map edge.
    const e = Math.max(Math.abs(x), Math.abs(z)) / HR_HALF;
    if (e > 0.78) h += Math.pow((e - 0.78) / 0.22, 2) * 55;
    // Flatten POIs and compounds.
    for (const p of POIS) {
      const d = Math.hypot(x - p.x, z - p.z);
      const w = smoothstep(p.radius + 32, p.radius * 0.8, d);
      h = h * (1 - w) + p.h * w;
    }
    for (const c of COMPOUNDS) {
      const d = Math.hypot(x - c.x, z - c.z);
      const w = smoothstep(c.r + 22, c.r * 0.7, d);
      h = h * (1 - w) + c.h * w;
    }
    // Pinewater lake basin.
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    h = h + (-3.5 - h) * smoothstep(LAKE.r + 8, LAKE.r - 12, dl);
    // Quarry pit with an access ramp from the east.
    const dq = Math.hypot(x - QUARRY.x, z - QUARRY.z);
    const ang = Math.atan2(z - QUARRY.z, x - QUARRY.x);
    let pit = smoothstep(QUARRY.r + 6, QUARRY.r - 4, dq);
    if (Math.abs(ang - 0.1) < 0.2) pit = Math.max(pit * 0.3, smoothstep(QUARRY.r + 34, QUARRY.r - 6, dq));
    h -= 17 * pit;
    return h;
  };

  const terrain = makeTerrain(HR_HALF, 2, height);
  const b = new MapBuilder(terrain);
  b.pois.push(...POIS.map(({ h: _h, ...p }) => p));
  for (const r of ROADS) b.regions.push({ kind: 'road', points: r, radius: 3.6 });
  b.regions.push({ kind: 'sand', cx: LAKE.x, cz: LAKE.z, radius: LAKE.r + 5 });
  b.regions.push({ kind: 'gravel', cx: QUARRY.x, cz: QUARRY.z, radius: QUARRY.r + 8 });
  b.regions.push({ kind: 'concrete', cx: 100, cz: 102, radius: 36 });
  b.regions.push({ kind: 'concrete', cx: 5, cz: -15, radius: 26 });
  b.regions.push({ kind: 'dirt', cx: 60, cz: 30, radius: 20 });

  buildRidgeway(b);
  buildIronworks(b);
  buildPinewater(b);
  buildQuarry(b);
  buildSkyline(b);
  buildChapel(b);
  buildCompounds(b);
  scatterNature(b, rng, noise2);

  // Deployment fallback spawns (not used by BR, but useful for debug).
  for (const p of POIS) b.spawns.push([p.x, p.z]);

  return b.finish('hollow_ridge', 'Hollow Ridge', HR_HALF, { waterLevel: WATER_LEVEL, fogDensity: 0.0026 });
}

// ------------------------------------------------------------------ POIs

function buildRidgeway(b: MapBuilder): void {
  const Y = 8;
  // North row
  b.house({ x: -128, z: 38, w: 10, d: 8, floors: 2, wallColor: C.cream, roofColor: C.roofRed, doorSides: ['s'], trimColor: C.white, baseY: Y + 0.15 });
  b.house({ x: -112, z: 38, w: 9, d: 8, wallColor: 0x8fb3c9, roofColor: C.roofBlue, doorSides: ['s', 'e'], baseY: Y + 0.15 });
  b.house({ x: -78, z: 38, w: 11, d: 9, floors: 2, wallColor: C.brick, roofColor: C.roofGrey, doorSides: ['s'], trimColor: C.cream, baseY: Y + 0.15 });
  b.house({ x: -62, z: 36, w: 8, d: 8, wallColor: 0xd9c27a, roofColor: C.roofGreen, doorSides: ['s', 'w'], baseY: Y + 0.15 });
  // South row
  b.house({ x: -128, z: 73, w: 10, d: 9, floors: 2, wallColor: 0xc98e6b, roofColor: C.roofGrey, doorSides: ['n'], trimColor: C.white, baseY: Y + 0.15 });
  // Ridge Mart store (flat roof, big windows).
  const s = b.house({ x: -104, z: 74, w: 16, d: 11, wallColor: C.white, roof: 'flat', doorSides: ['n'], floorColor: 0xc9c9c2, baseY: Y + 0.15, chest: true });
  b.deco('box', [-104, s.y + 3.9, 68.2], [12, 1.3, 0.3], C.red, [0, 0, 0]);
  b.sign(-104, 67.9, 0, 'RIDGE MART', 9, s.y + 3.95, '#ffffff');
  for (let i = 0; i < 3; i++) b.box(-110 + i * 5, s.y, 76, -107 + i * 5, s.y + 1.4, 77, C.blue); // shelves
  b.lootSpots.push([-104, s.y + 0.1, 72], [-98, s.y + 0.1, 77]);
  b.house({ x: -78, z: 74, w: 10, d: 9, wallColor: 0x9ec28f, roofColor: C.roofRed, doorSides: ['n', 'e'], baseY: Y + 0.15 });
  // Gas station
  const gx = -56;
  const gz = 60;
  for (const [px, pz] of [[-5, -4], [5, -4], [-5, 4], [5, 4]]) b.block(gx + px, Y, gz + pz, 0.5, 5, 0.5, C.white);
  b.box(gx - 7, Y + 5, gz - 5.5, gx + 7, Y + 5.6, gz + 5.5, C.red);
  b.deco('box', [gx, Y + 5.3, gz - 5.6], [14, 0.4, 0.1], C.yellow, [0, 0, 0], { emissive: true });
  b.sign(gx, gz - 5.7, 0, 'FUEL & GO', 6, Y + 5.25, '#1d2024');
  b.block(gx - 2, Y, gz, 1, 1.4, 0.8, C.metalDark);
  b.block(gx + 2, Y, gz, 1, 1.4, 0.8, C.metalDark);
  b.house({ x: gx + 12, z: gz + 1, w: 7, d: 6, wallColor: C.white, roof: 'flat', doorSides: ['w'], baseY: Y + 0.15 });
  b.lights.push({ x: gx, y: Y + 4.6, z: gz, color: 0xfff0c8, intensity: 3, distance: 16 });
  // Parking lot + cars
  b.prop('car', -95, null, 62, 0.1, 0x3b73c4);
  b.prop('car', -113, null, 61, Math.PI / 2 + 0.2, 0xd9d4c7);
  b.prop('car', -60, null, 48, 1.2, 0x7a2f2a);
  b.prop('car', -140, null, 57, 0.05, 0x3f6b4a);
  // Water tower landmark
  const tx = -96;
  const tz = 22;
  const tg = b.ground(tx, tz);
  for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) b.block(tx + px, tg, tz + pz, 0.45, 16, 0.45, C.metalDark, { material: 'metal' });
  b.deco('box', [tx, tg + 8, tz - 2.6], [5.2, 0.2, 0.2], C.metalDark, [0, 0, 0.8]);
  b.deco('box', [tx, tg + 8, tz + 2.6], [5.2, 0.2, 0.2], C.metalDark, [0, 0, -0.8]);
  b.box(tx - 3.2, tg + 16, tz - 3.2, tx + 3.2, tg + 16.3, tz + 3.2, C.metalDark, { material: 'metal' });
  b.deco('cyl', [tx, tg + 19, tz], [3.4, 5.4, 3.4], 0x7fa9c2, [0, 0, 0], { segments: 16 });
  b.box(tx - 2.4, tg + 16.3, tz - 2.4, tx + 2.4, tg + 21.7, tz + 2.4, 0x7fa9c2, { collide: true, material: 'metal' });
  b.boxes[b.boxes.length - 1].color = -1; // collision-only (visual is the cylinder)
  b.deco('cone', [tx, tg + 22.8, tz], [3.7, 2.2, 3.7], C.roofBlue, [0, 0, 0], { segments: 16 });
  b.sign(tx, tz + 3.45, 0, 'RIDGEWAY', 6, tg + 19.2, '#ffffff');
  b.chests.push({ x: tx, y: tg + 21.7, z: tz, rotY: 0, kind: 'supply' });
  // Street furniture
  for (let x = -140; x <= -50; x += 18) {
    b.lamp(x, 49);
    b.lamp(x + 9, 63);
  }
  b.fence(-140, 30, -140, 45, C.white);
  b.fence(-140, 84, -115, 84, C.woodLight, true);
  b.fence(-70, 84, -50, 84, C.woodLight, true);
  for (const [x, z] of [[-121, 55], [-88, 47], [-70, 66], [-120, 88], [-100, 45]]) b.prop('crate', x, null, z, 0.3);
  for (const [x, z] of [[-116, 48], [-84, 64], [-64, 70]]) b.prop('barrel', x, null, z);
  b.sign(-150, 50, Math.PI / 2, 'RIDGEWAY  POP. 0', 5);
  for (const [x, z] of [[-100, 55], [-88, 55], [-120, 64], [-68, 50], [-58, 68]]) b.lootSpots.push([x, b.ground(x, z) + 0.1, z]);
}

function buildIronworks(b: MapBuilder): void {
  const Y = 5;
  const cx = 95;
  const cz = 98;
  // Warehouse shell with huge openings.
  const w = 30;
  const d = 18;
  const H = 9;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  b.box(x0, Y - 0.3, z0, x1, Y + 0.05, z1, C.concreteDark);
  b.wall('x', z1, x0, x1, Y, H, 0.4, 0x6f7f8e, [{ start: 5, end: 11, bottom: 0, top: 5.5 }, { start: 19, end: 25, bottom: 0, top: 5.5 }], 'metal');
  b.wall('x', z0, x0, x1, Y, H, 0.4, 0x6f7f8e, [{ start: 12, end: 18, bottom: 0, top: 5.5 }, { start: 3, end: 6, bottom: 5.8, top: 7.5 }, { start: 24, end: 27, bottom: 5.8, top: 7.5 }], 'metal');
  b.wall('z', x0, z0 + 0.2, z1 - 0.2, Y, H, 0.4, 0x6f7f8e, [{ start: 7, end: 10.5, bottom: 0, top: 3.6, door: true }], 'metal');
  b.wall('z', x1, z0 + 0.2, z1 - 0.2, Y, H, 0.4, 0x6f7f8e, [{ start: 6, end: 11, bottom: 0, top: 5.5 }], 'metal');
  b.box(x0 - 0.5, Y + H, z0 - 0.5, x1 + 0.5, Y + H + 0.4, z1 + 0.5, 0x5d6771, { material: 'metal' });
  b.deco('box', [cx, Y + H + 0.45, cz], [w - 2, 0.1, 1.2], 0xc9d7de);
  // Catwalk along the north wall inside, with stairs.
  b.box(x0 + 0.2, Y + 4.4, z0 + 0.2, x1 - 0.2, Y + 4.6, z0 + 2.4, C.metalDark, { material: 'metal' });
  b.stairs(x0 + 2, Y, z0 + 6.4, '-z', 1.6, 4.4, C.metalDark);
  for (let x = x0 + 1; x < x1; x += 3) b.deco('box', [x, Y + 5.1, z0 + 2.4], [0.08, 1.0, 0.08], C.yellow);
  b.deco('box', [cx, Y + 5.55, z0 + 2.4], [w - 0.4, 0.08, 0.08], C.yellow);
  // Interior clutter
  b.block(cx - 6, Y, cz + 2, 6, 2.6, 2.4, C.rust, { material: 'metal' });
  b.block(cx + 7, Y, cz + 3, 3, 1.6, 3, C.metal, { material: 'metal' });
  b.block(cx + 7, Y + 1.6, cz + 3, 2, 1.2, 2, C.metalDark, { material: 'metal' });
  b.chests.push({ x: cx, y: Y + 4.6, z: z0 + 1.3, rotY: 0, kind: 'chest' });
  b.chests.push({ x: cx + 10, y: Y + 0.05, z: cz + 6, rotY: Math.PI, kind: 'chest' });
  b.lootSpots.push([cx - 10, Y + 0.1, cz], [cx + 3, Y + 0.1, cz - 4], [cx - 4, Y + 4.7, z0 + 1.2]);
  b.sign(cx, z1 + 0.25, 0, 'IRONWORKS', 10, Y + 7.2, '#ffcf5a');
  // Shipping containers (static, stackable cover).
  const colors = [0xb8452d, 0x2f6fa8, 0x3f8a52, 0xd3a02a, 0x6b4a8c, 0x2c8b8b];
  let ci = 0;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = 78 + col * 9;
      const z = 124 + row * 7;
      const stack = (row + col) % 3 === 0 ? 2 : 1;
      for (let s = 0; s < stack; s++) {
        const color = colors[ci++ % colors.length];
        b.block(x, Y + s * 2.6, z, 6.1, 2.6, 2.5, color, { material: 'metal' });
        b.deco('box', [x, Y + s * 2.6 + 1.3, z + 1.26], [5.6, 2.2, 0.04], color - 0x111111);
      }
    }
  }
  b.chests.push({ x: 87, y: Y + 5.2, z: 124, rotY: 0, kind: 'chest' });
  b.lootSpots.push([96, Y + 0.1, 128], [82, Y + 0.1, 131]);
  // Crane landmark.
  const kx = 128;
  const kz = 122;
  const top = 28;
  for (const [px, pz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) b.block(kx + px, Y, kz + pz, 0.35, top, 0.35, C.yellow, { material: 'metal' });
  for (let h = 2; h < top; h += 3) {
    b.deco('box', [kx, Y + h, kz - 1.2], [2.6, 0.15, 0.15], C.yellow, [0, 0, 0.9]);
    b.deco('box', [kx, Y + h, kz + 1.2], [2.6, 0.15, 0.15], C.yellow, [0, 0, -0.9]);
    b.deco('box', [kx - 1.2, Y + h, kz], [0.15, 0.15, 2.6], C.yellow, [0.9, 0, 0]);
  }
  b.box(kx - 1.6, Y + top, kz - 1.6, kx + 1.6, Y + top + 0.3, kz + 1.6, C.yellow, { material: 'metal' });
  b.block(kx, Y + top + 0.3, kz, 2.4, 2.2, 2.4, C.white, { material: 'metal' });
  b.box(kx - 26, Y + top + 2.5, kz - 0.7, kx + 8, Y + top + 3.2, kz + 0.7, C.yellow, { material: 'metal' });
  b.block(kx + 6.5, Y + top + 0.3, kz, 2.6, 2.2, 2.2, C.concreteDark);
  b.deco('cyl', [kx - 20, Y + top - 5, kz], [0.05, 15, 0.05], C.black);
  b.deco('box', [kx - 20, Y + top - 12.8, kz], [1, 0.8, 1], C.orange);
  b.lights.push({ x: kx, y: Y + top + 4, z: kz, color: 0xff4444, intensity: 2, distance: 14 });
  b.deco('sphere', [kx, Y + top + 3.5, kz], [0.3, 0.3, 0.3], 0xff3b30, [0, 0, 0], { emissive: true });
  // Smokestack
  b.deco('cyl', [66, Y + 11, 84], [1.8, 22, 1.8], C.brickDark, [0, 0, 0], { segments: 14 });
  b.block(66, Y, 84, 2.8, 22, 2.8, C.brickDark);
  b.boxes[b.boxes.length - 1].color = -1;
  for (let i = 0; i < 3; i++) b.deco('cyl', [66, Y + 18 + i * 1.4, 84], [1.95, 0.35, 1.95], C.white, [0, 0, 0], { segments: 14 });
  // Pipes + tanks
  b.deco('cyl', [72, Y + 3, 96], [0.5, 16, 0.5], C.metal, [Math.PI / 2, 0, 0]);
  b.deco('cyl', [118, Y + 3.5, 86], [3, 7, 3], 0xb9c3cc, [0, 0, 0], { segments: 18 });
  b.block(118, Y, 86, 4.4, 7, 4.4, 0xb9c3cc, { material: 'metal' });
  b.boxes[b.boxes.length - 1].color = -1;
  // Catwalk bridge between tank and warehouse roof.
  b.box(x1, Y + H, 85.5, 116, Y + H + 0.25, 87, C.metalDark, { material: 'metal' });
  for (const [x, z] of [[76, 108], [114, 110], [120, 98], [72, 118], [104, 118], [110, 132]]) b.prop('barrel', x, null, z);
  for (const [x, z] of [[74, 112], [116, 114], [70, 100]]) b.prop('crate', x, null, z, 0.4);
  b.prop('car', 110, null, 76, 1.4, 0x505a63);
  for (let x = 64; x <= 136; x += 12) b.lamp(x, 78);
  b.fence(62, 72, 62, 140, C.metal);
}

function buildPinewater(b: MapBuilder): void {
  const W = WATER_LEVEL;
  // Dock
  const dx0 = -76;
  b.box(dx0 - 16, W + 0.5, -107, dx0, W + 0.75, -103, C.wood, { material: 'wood' });
  for (let x = dx0 - 15; x <= dx0; x += 3) {
    b.deco('cyl', [x, W - 0.5, -107], [0.18, 2.6, 0.18], C.woodDark);
    b.deco('cyl', [x, W - 0.5, -103], [0.18, 2.6, 0.18], C.woodDark);
  }
  b.box(dx0 - 20, W + 0.5, -111, dx0 - 16, W + 0.75, -99, C.wood, { material: 'wood' });
  b.prop('crate', dx0 - 18, W + 0.75, -109.5, 0.2);
  b.lootSpots.push([dx0 - 18, W + 0.85, -101]);
  // A small boat
  b.deco('box', [dx0 - 10, W + 0.2, -99.5], [5, 0.8, 1.8], 0xd9d4c7, [0, 0.15, 0]);
  b.deco('box', [dx0 - 10, W + 0.65, -99.5], [4.6, 0.12, 1.4], C.wood, [0, 0.15, 0]);
  // Large lake cabin (landmark): two-storey log cabin.
  const g = b.ground(-54, -92);
  b.house({ x: -54, z: -92, w: 14, d: 10, floors: 2, wallColor: 0x8b5e3c, roofColor: C.roofGreen, doorSides: ['w', 's'], trimColor: C.woodDark, material: 'wood', baseY: g + 0.4 });
  b.box(-64, g - 0.2, -99, -61, g + 0.4, -85, C.wood, { material: 'wood' }); // porch
  b.deco('box', [-54 + 5, g + 9.5, -92], [1.2, 3.5, 1.2], 0x6e695e); // chimney
  b.sign(-66, -84, Math.PI / 2, 'PINEWATER LODGE', 6);
  // Boathouse
  const bg = b.ground(-72, -128);
  b.house({ x: -72, z: -128, w: 8, d: 7, wallColor: 0x4f6f86, roofColor: C.roofGrey, doorSides: ['n', 'w'], baseY: Math.max(bg, W + 0.3) + 0.2 });
  // Fishing camp
  b.deco('cone', [-120, b.ground(-120, -64) + 1.3, -64], [2, 2.6, 2], 0xd9763a, [0, 0, 0], { segments: 6 });
  b.deco('cone', [-127, b.ground(-127, -68) + 1.2, -68], [1.8, 2.4, 1.8], 0x3f8a52, [0, 0, 0], { segments: 6 });
  b.deco('cyl', [-123, b.ground(-123, -70) + 0.2, -70], [0.8, 0.4, 0.8], C.stoneDark);
  b.lights.push({ x: -123, y: b.ground(-123, -70) + 1.2, z: -70, color: 0xff9944, intensity: 2, distance: 10 });
  b.lootSpots.push([-121, b.ground(-121, -70) + 0.1, -70]);
  b.chests.push({ x: -126, y: b.ground(-126, -62), z: -62, rotY: 0.4, kind: 'chest' });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.3;
    const r = LAKE.r + 9 + (i % 3) * 3;
    b.rock(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r, 1 + (i % 4) * 0.4, a);
  }
}

function buildQuarry(b: MapBuilder): void {
  const floorY = b.ground(QUARRY.x, QUARRY.z);
  // Excavator landmark on the pit floor.
  const ex = 98;
  const ez = -96;
  b.block(ex - 1.8, floorY, ez, 1.2, 1.2, 6, 0x2b2b2b, { material: 'metal' });
  b.block(ex + 1.8, floorY, ez, 1.2, 1.2, 6, 0x2b2b2b, { material: 'metal' });
  b.block(ex, floorY + 1.2, ez, 4.6, 1.8, 5, C.yellow, { material: 'metal' });
  b.block(ex - 1.1, floorY + 3, ez + 1.2, 2.2, 2, 2.2, C.yellow, { material: 'metal' });
  b.deco('box', [ex - 1.1, floorY + 4.1, ez + 0.05], [1.8, 1.2, 0.05], C.glass);
  b.deco('box', [ex + 0.8, floorY + 5, ez - 4.2], [0.9, 0.9, 7], C.yellow, [0.55, 0, 0]);
  b.deco('box', [ex + 0.8, floorY + 4.4, ez - 9.6], [0.8, 0.8, 5], C.yellow, [-0.9, 0, 0]);
  b.deco('box', [ex + 0.8, floorY + 1.4, ez - 11.2], [2.2, 1.4, 1.6], 0x5a5f66, [0.3, 0, 0]);
  b.sign(ex + 3, ez + 3, Math.PI / 2, 'OLD QUARRY', 5, floorY + 2.2);
  // Covered mine galleries on the pit floor.
  for (const [gx, gz, len] of [[88, -76, 16], [114, -108, 14]] as [number, number, number][]) {
    const y = b.ground(gx, gz);
    b.wall('x', gz - 1.8, gx - len / 2, gx + len / 2, y, 3.2, 0.4, C.woodDark, [], 'wood');
    b.wall('x', gz + 1.8, gx - len / 2, gx + len / 2, y, 3.2, 0.4, C.woodDark, [{ start: len / 2 - 1, end: len / 2 + 1, bottom: 0, top: 2.6 }], 'wood');
    b.box(gx - len / 2 - 0.2, y + 3.2, gz - 2.2, gx + len / 2 + 0.2, y + 3.6, gz + 2.2, C.wood, { material: 'wood' });
    for (let x = gx - len / 2; x <= gx + len / 2; x += 4) b.deco('box', [x, y + 3.05, gz], [0.3, 0.3, 3.6], C.woodLight);
    b.lights.push({ x: gx, y: y + 2.6, z: gz, color: 0xffb35c, intensity: 2.5, distance: 10 });
    b.chests.push({ x: gx + len / 2 - 1, y, z: gz, rotY: -Math.PI / 2, kind: 'chest' });
    b.lootSpots.push([gx - len / 2 + 2, y + 0.1, gz]);
  }
  // Rim sheds + office
  b.house({ x: 140, z: -64, w: 9, d: 7, wallColor: 0xb7a27a, roof: 'flat', doorSides: ['w'] });
  b.house({ x: 76, z: -122, w: 7, d: 6, wallColor: 0x8e8a7c, roofColor: C.roofGrey, doorSides: ['n'] });
  // Conveyor belt
  const cy = b.ground(136, -96);
  b.deco('box', [124, (cy + floorY) / 2 + 2, -96], [26, 0.5, 1.6], 0x3a3d42, [0, 0, -Math.atan2(cy - floorY, 26)]);
  for (let i = 0; i < 4; i++) {
    const x = 114 + i * 7;
    const top = floorY + ((x - 111) / 26) * (cy - floorY) + 1.8;
    b.deco('box', [x, (b.ground(x, -96) + top) / 2, -96], [0.4, Math.max(0.5, top - b.ground(x, -96)), 0.4], C.metalDark);
  }
  // Stone piles (harvestable) inside the pit
  const rng = new Rng('quarry-rocks');
  for (let i = 0; i < 22; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(4, QUARRY.r - 5);
    b.rock(QUARRY.x + Math.cos(a) * r, QUARRY.z + Math.sin(a) * r, rng.range(0.9, 2.2), a);
  }
  for (const [x, z] of [[108, -84], [96, -104], [118, -94]]) b.prop('barrel', x, null, z);
  b.prop('car', 150, null, -80, 2.1, 0xc9b28a);
  b.lootSpots.push([QUARRY.x + 6, floorY + 0.1, QUARRY.z + 8], [QUARRY.x - 10, floorY + 0.1, QUARRY.z - 2]);
  b.chests.push({ x: QUARRY.x + 2, y: floorY, z: QUARRY.z + 12, rotY: 0, kind: 'supply' });
}

function buildSkyline(b: MapBuilder): void {
  const Y = 15.15;
  const cx = 2;
  const cz = -12;
  const w = 26;
  const d = 16;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const H = 3.6;
  b.box(x0 - 1, Y - 0.4, z0 - 1, x1 + 1, Y + 0.05, z1 + 1, 0xd4d8dc);
  for (let f = 0; f < 2; f++) {
    const fy = Y + f * H;
    // Concrete columns + glass panels (glass stops players, bullets pass).
    for (let i = 0; i <= 6; i++) {
      const x = x0 + (i / 6) * w;
      b.block(x, fy, z0, 0.5, H, 0.5, 0xe8ecef);
      b.block(x, fy, z1, 0.5, H, 0.5, 0xe8ecef);
    }
    for (let i = 0; i < 6; i++) {
      const xa = x0 + (i / 6) * w + 0.25;
      const xb = x0 + ((i + 1) / 6) * w - 0.25;
      const doorPanel = f === 0 && i === 3;
      if (!doorPanel) b.box(xa, fy, z1 - 0.06, xb, fy + H, z1 + 0.06, C.glass, { glass: true, material: 'glass' });
      if (!(f === 0 && i === 1)) b.box(xa, fy, z0 - 0.06, xb, fy + H, z0 + 0.06, C.glass, { glass: true, material: 'glass' });
    }
    b.wall('z', x0, z0 + 0.25, z1 - 0.25, fy, H, 0.35, 0xe8ecef, f === 0 ? [{ start: 6, end: 8, bottom: 0, top: 2.6, door: true }] : [{ start: 3, end: 11, bottom: 1.2, top: 2.8 }]);
    b.wall('z', x1, z0 + 0.25, z1 - 0.25, fy, H, 0.35, 0xe8ecef, [{ start: 3, end: 11, bottom: 1.2, top: 2.8 }]);
    if (f === 0) {
      // Security door frame on the south entrance.
      const dx = x0 + (3.5 / 6) * w;
      b.doors.push({ x: dx, y: fy, z: z1, axis: 0, width: w / 6 - 0.5, height: 2.8, color: 0x2e3a46 });
      b.box(dx - w / 12 + 0.25, fy + 2.8, z1 - 0.1, dx + w / 12 - 0.25, fy + H, z1 + 0.1, 0xe8ecef);
      b.doors.push({ x: x0 + (1.5 / 6) * w, y: fy, z: z0, axis: 0, width: w / 6 - 0.5, height: 2.8, color: 0x2e3a46 });
      b.box(x0 + (1.5 / 6) * w - w / 12 + 0.25, fy + 2.8, z0 - 0.1, x0 + (1.5 / 6) * w + w / 12 - 0.25, fy + H, z0 + 0.1, 0xe8ecef);
      // Server room: glass partition + server racks with emissive strips.
      b.box(cx + 3, fy, z0 + 0.3, cx + 3.15, fy + H, z1 - 4, C.glass, { glass: true, material: 'glass' });
      for (let r = 0; r < 3; r++) {
        const rx = cx + 5.5 + r * 2.4;
        b.box(rx, fy, z0 + 2, rx + 1, fy + 2.4, z1 - 5, 0x1f2833, { material: 'metal' });
        b.deco('box', [rx - 0.02, fy + 1.4, cz - 1.5], [0.04, 0.08, d - 7.5], C.cyan, [0, 0, 0], { emissive: true });
        b.deco('box', [rx - 0.02, fy + 0.8, cz - 1.5], [0.04, 0.08, d - 7.5], 0x3cff9b, [0, 0, 0], { emissive: true });
      }
      b.chests.push({ x: cx + 8, y: fy + 0.05, z: z1 - 2, rotY: 0, kind: 'chest' });
      b.lootSpots.push([cx - 8, fy + 0.1, cz], [cx - 2, fy + 0.1, cz + 3]);
      // Lab benches
      b.block(cx - 7, fy, cz - 3, 5, 1, 1.4, 0xf2f4f5);
      b.block(cx - 7, fy, cz + 2, 5, 1, 1.4, 0xf2f4f5);
      b.lights.push({ x: cx + 7, y: fy + 3, z: cz, color: 0x66e0ff, intensity: 3, distance: 14 });
    } else {
      b.chests.push({ x: cx - 9, y: fy + 0.05, z: z0 + 2, rotY: 0, kind: 'chest' });
      b.lootSpots.push([cx + 6, fy + 0.1, cz], [cx - 3, fy + 0.1, cz - 3]);
      // Glass meeting room
      b.box(cx - 2, fy, z0 + 0.3, cx - 1.85, fy + H, cz + 1, C.glass, { glass: true, material: 'glass' });
      b.box(cx - 12.5, fy, cz + 1, cx - 1.85, fy + H, cz + 1.15, C.glass, { glass: true, material: 'glass' });
    }
    if (f === 1) b.slab(x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, fy, 0.3, 0xd4d8dc, [x1 - 5.3, z0 + 0.3, x1 - 0.3, z0 + 5.4]);
  }
  // Interior stairs (east side)
  b.stairs(x1 - 2.8, Y, z0 + 5.4, '-z', 2, H, 0x9aa4ad);
  // Roof + helipad
  const ry = Y + 2 * H;
  b.slab(x0, z0, x1, z1, ry + 0.3, 0.3, 0xcfd6dc);
  b.deco('cyl', [cx - 5, ry + 0.32, cz], [4, 0.04, 4], 0x2f3a45, [0, 0, 0], { segments: 24 });
  b.sign(cx - 5, cz, 0, 'H', 3, ry + 0.4, '#ffd23f');
  b.signs[b.signs.length - 1].rotY = -Math.PI / 2;
  b.chests.push({ x: cx + 8, y: ry + 0.3, z: cz, rotY: 0, kind: 'supply' });
  b.deco('cyl', [cx + 9, ry + 1.4, cz - 5], [1.3, 0.3, 1.3], 0xdfe6ea, [0.6, 0, 0], { segments: 16 });
  b.deco('cyl', [cx + 9, ry + 0.6, cz - 5], [0.15, 1.2, 0.15], C.metal);
  b.sign(cx, z1 + 0.7, 0, 'SKYLINE LABS', 12, Y + 2 * H + 1.2, '#5ee7ff');
  b.box(cx - 7, Y + 2 * H + 0.6, z1 + 0.4, cx + 7, Y + 2 * H + 1.9, z1 + 0.6, 0x1b2733);
  // Glowing containment tower (landmark)
  const tx = 24;
  const tz = -34;
  const tg = b.ground(tx, tz);
  b.deco('cyl', [tx, tg + 16, tz], [2.2, 32, 2.2], 0x2b3a4a, [0, 0, 0], { segments: 16 });
  b.block(tx, tg, tz, 3.2, 32, 3.2, 0x2b3a4a, { material: 'metal' });
  b.boxes[b.boxes.length - 1].color = -1;
  for (let i = 0; i < 6; i++) b.deco('cyl', [tx, tg + 5 + i * 5, tz], [2.35, 0.35, 2.35], C.cyan, [0, 0, 0], { emissive: true, segments: 16 });
  b.deco('sphere', [tx, tg + 33.5, tz], [2.4, 2.4, 2.4], 0x9ef4ff, [0, 0, 0], { emissive: true });
  b.lights.push({ x: tx, y: tg + 33, z: tz, color: 0x5ee7ff, intensity: 6, distance: 45 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.deco('box', [tx + Math.cos(a) * 3.5, tg + 4, tz + Math.sin(a) * 3.5], [0.6, 8, 0.6], 0x3b4b5c, [Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]);
  }
  b.sign(tx - 3.5, tz + 4, 0, 'CONTAINMENT DIVISION  —  AUTHORISED ONLY', 8);
  // Perimeter fence with gate gaps
  b.fence(-26, 14, -8, 14, C.metal);
  b.fence(12, 14, 34, 14, C.metal);
  b.fence(-26, -42, 34, -42, C.metal, true);
  b.lights.push({ x: cx, y: Y + 6, z: z1 + 3, color: 0x9ef4ff, intensity: 2, distance: 16 });
  b.prop('car', -18, null, 4, 0.2, 0xf4f5f6);
  b.prop('car', 22, null, 6, -0.1, 0x22324a);
  for (const [x, z] of [[-20, -28], [28, -8], [16, 8]]) b.prop('crate', x, null, z, 0.2);
}

function buildChapel(b: MapBuilder): void {
  const cx = -15;
  const cz = 150;
  const g = b.ground(cx, cz);
  const w = 10;
  const d = 16;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const z0 = cz - d / 2;
  const z1 = cz + d / 2;
  const baseH = 3;
  const stone = 0x9a9384;
  // Basement (ground-level room inside the plinth).
  b.box(x0, g - 0.3, z0, x1, g + 0.05, z1, C.stoneDark, { material: 'stone' });
  b.wall('x', z0, x0, x1, g, baseH, 0.6, C.stoneDark, [], 'stone');
  b.wall('x', z1, x0, x1, g, baseH, 0.6, C.stoneDark, [{ start: 1, end: 2.4, bottom: 1.6, top: 2.4 }], 'stone');
  b.wall('z', x0, z0 + 0.3, z1 - 0.3, g, baseH, 0.6, C.stoneDark, [{ start: 2, end: 3.2, bottom: 1.6, top: 2.4 }], 'stone');
  b.wall('z', x1, z0 + 0.3, z1 - 0.3, g, baseH, 0.6, C.stoneDark, [], 'stone');
  // Chapel floor with a stair hole down to the basement.
  const hole = b.stairs(x0 + 1.2, g, z0 + 1, 'z', 1.4, baseH, C.stoneDark);
  b.slab(x0, z0, x1, z1, g + baseH, 0.35, stone, [hole[0] - 0.1, hole[1], hole[2] + 0.1, hole[3] + 0.1]);
  b.chests.push({ x: x1 - 1.3, y: g + 0.05, z: cz + 4, rotY: -Math.PI / 2, kind: 'supply' });
  b.chests.push({ x: x1 - 1.3, y: g + 0.05, z: cz - 3, rotY: -Math.PI / 2, kind: 'chest' });
  b.lootSpots.push([cx, g + 0.1, cz + 5]);
  b.lights.push({ x: cx, y: g + 2.4, z: cz, color: 0xffa050, intensity: 2, distance: 10 });
  // Front steps up to the chapel
  b.stairs(cx, g, z1 + 3.2, '-z', 3, baseH, stone);
  // Ruined chapel walls (varying heights = ruin silhouette)
  const fy = g + baseH;
  const heights = [5.5, 3.2, 6, 2, 4.8];
  for (let i = 0; i < 5; i++) {
    const za = z0 + i * (d / 5);
    const zb = za + d / 5;
    const hh = heights[i];
    b.wall('z', x0, za, zb, fy, hh, 0.7, stone, i % 2 === 0 ? [{ start: 1, end: 2, bottom: 1.5, top: 3.4 }] : [], 'stone');
    b.wall('z', x1, za, zb, fy, heights[(i + 2) % 5], 0.7, stone, i % 2 === 1 ? [{ start: 1, end: 2, bottom: 1.5, top: 3 }] : [], 'stone');
  }
  b.wall('x', z1, x0, x1, fy, 6.5, 0.7, stone, [{ start: 3.5, end: 6.5, bottom: 0, top: 3.6 }], 'stone');
  b.deco('cyl', [cx, fy + 5, z1 + 0.2], [1.1, 0.2, 1.1], 0x4466aa, [Math.PI / 2, 0, 0], { emissive: true, segments: 12 });
  // Partial collapsed roof beams
  b.deco('box', [cx, fy + 5.8, cz + 3], [w + 1, 0.4, 0.4], C.woodDark, [0, 0, 0.12]);
  b.deco('box', [cx - 1, fy + 3.5, cz - 2], [w - 1, 0.4, 0.4], C.woodDark, [0.3, 0.4, 0.6]);
  // Pews
  for (let i = 0; i < 4; i++) {
    b.block(cx - 2.2, fy, z1 - 4 - i * 2.2, 3, 0.9, 0.6, C.woodDark, { material: 'wood' });
    if (i !== 2) b.block(cx + 2.2, fy, z1 - 4 - i * 2.2, 3, 0.9, 0.6, C.woodDark, { material: 'wood' });
  }
  b.lootSpots.push([cx, fy + 0.1, cz - 4]);
  // Broken bell tower at the back.
  const tz = z0 - 2.5;
  b.block(cx, g, tz, 4.5, 15, 4.5, stone, { material: 'stone' });
  b.block(cx - 1.4, g + 15, tz - 1.4, 1.2, 3.5, 1.2, stone, { material: 'stone' });
  b.block(cx + 1.4, g + 15, tz - 1.4, 1.2, 2.2, 1.2, stone, { material: 'stone' });
  b.block(cx - 1.4, g + 15, tz + 1.4, 1.2, 1.4, 1.2, stone, { material: 'stone' });
  b.deco('cone', [cx + 0.3, g + 16.2, tz + 0.3], [1, 1.6, 1], 0x9c7a2a, [0.5, 0, 0.3], { segments: 10 });
  b.chests.push({ x: cx, y: g + 15, z: tz, rotY: 0, kind: 'chest' });
  // Moss & overgrowth
  for (let i = 0; i < 12; i++) {
    const a = i * 2.3;
    b.deco('sphere', [cx + Math.cos(a) * 5.4, fy + (i % 4) * 1.2, cz + Math.sin(a) * 8], [1.2, 0.8, 1.2], C.moss);
  }
  // Graves
  for (let i = 0; i < 8; i++) {
    const gx = cx + 9 + (i % 4) * 2.4;
    const gz = cz - 4 + Math.floor(i / 4) * 4;
    const gg = b.ground(gx, gz);
    b.deco('box', [gx, gg + 0.5, gz], [0.9, 1.1, 0.25], 0x8a8578, [0.12 * (i % 3), 0, 0.08 * ((i % 2) * 2 - 1)]);
  }
  b.fence(cx + 7, cz - 7, cx + 18, cz - 7, 0x3a3a3a, true);
  b.sign(cx - 9, z1 + 4, 0.4, 'OVERGROWN CHAPEL', 5);
}

function buildCompounds(b: MapBuilder): void {
  // Farm: barn, silo, farmhouse.
  const barnG = b.ground(52, 26);
  b.house({ x: 52, z: 26, w: 12, d: 16, wallColor: 0xa83a2c, roofColor: 0x4b4b4b, doorSides: ['e', 'w'], trimColor: C.white, windows: false, material: 'wood', baseY: barnG + 0.2 });
  b.box(46.2, barnG + 3.6, 18.5, 57.8, barnG + 3.8, 23.5, C.woodLight, { material: 'wood' }); // hay loft
  b.lootSpots.push([50, barnG + 3.9, 20]);
  b.stairs(47.2, barnG + 0.2, 28, '-z', 1.2, 3.6, C.wood);
  b.deco('cyl', [64, b.ground(64, 16) + 7, 16], [2.6, 14, 2.6], 0xb9c3cc, [0, 0, 0], { segments: 16 });
  b.deco('sphere', [64, b.ground(64, 16) + 14, 16], [2.6, 1.6, 2.6], 0x8d99a6);
  b.block(64, b.ground(64, 16), 16, 3.8, 14, 3.8, 0xb9c3cc, { material: 'metal' });
  b.boxes[b.boxes.length - 1].color = -1;
  b.house({ x: 72, z: 40, w: 9, d: 8, floors: 2, wallColor: C.cream, roofColor: C.roofBlue, doorSides: ['w'], trimColor: C.white });
  b.fence(38, 10, 80, 10, C.woodLight, true);
  b.fence(38, 10, 38, 48, C.woodLight, true);
  for (const [x, z] of [[60, 34], [44, 36], [66, 26]]) b.prop('crate', x, null, z, 0.3);
  for (let i = 0; i < 5; i++) b.deco('cyl', [42 + i * 2.2, b.ground(42 + i * 2.2, 44) + 0.6, 44], [0.7, 1.2, 0.7], 0xd9b85a, [Math.PI / 2, 0, 0], { segments: 10 });
  b.prop('car', 58, null, 44, 0.8, 0x6d3f2a);

  // Radio outpost with mast.
  const rx = -170;
  const rz = -25;
  const rg = b.ground(rx, rz);
  b.house({ x: rx, z: rz, w: 8, d: 6, wallColor: 0x6b7a5a, roof: 'flat', doorSides: ['e'], baseY: rg + 0.2 });
  const mg = b.ground(rx - 8, rz + 6);
  b.block(rx - 8, mg, rz + 6, 0.6, 24, 0.6, 0xc9443a, { material: 'metal' });
  for (let i = 0; i < 4; i++) b.deco('box', [rx - 8, mg + 6 + i * 5, rz + 6], [0.08, 0.08, 6], C.white, [0.3, 0, 0]);
  b.deco('sphere', [rx - 8, mg + 24.3, rz + 6], [0.3, 0.3, 0.3], 0xff3b30, [0, 0, 0], { emissive: true });
  b.lights.push({ x: rx - 8, y: mg + 24.5, z: rz + 6, color: 0xff3b30, intensity: 1.5, distance: 10 });
  b.sign(rx + 6, rz + 5, -Math.PI / 2, 'RELAY STATION 7', 4);

  // Lookout camp + watchtower
  const lx = 45;
  const lz = -155;
  const lg = b.ground(lx, lz);
  b.house({ x: lx - 6, z: lz, w: 7, d: 6, wallColor: 0x7a5a3c, roofColor: C.roofGreen, doorSides: ['e'], material: 'wood' });
  for (const [px, pz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) b.block(lx + 8 + px, lg, lz + pz, 0.35, 8, 0.35, C.woodDark, { material: 'wood' });
  b.box(lx + 5.8, lg + 8, lz - 2.2, lx + 10.2, lg + 8.25, lz + 2.2, C.wood, { material: 'wood' });
  b.box(lx + 5.8, lg + 8.25, lz - 2.2, lx + 10.2, lg + 9.2, lz - 2.05, C.wood, { material: 'wood' });
  b.box(lx + 5.8, lg + 8.25, lz + 2.05, lx + 10.2, lg + 9.2, lz + 2.2, C.wood, { material: 'wood' });
  b.gableRoof(lx + 5.5, lz - 2.5, lx + 10.5, lz + 2.5, lg + 11, 1.2, 'x', C.roofGreen);
  for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) b.deco('box', [lx + 8 + px, lg + 10, lz + pz], [0.2, 2, 0.2], C.woodDark);
  b.stairs(lx + 8, lg, lz + 10.4, '-z', 1.2, 8, C.wood);
  b.chests.push({ x: lx + 8, y: lg + 8.25, z: lz, rotY: 0, kind: 'chest' });

  // Diner rest stop
  const dg = b.ground(170, 20);
  b.house({ x: 170, z: 20, w: 12, d: 8, wallColor: 0xe3e3e3, roof: 'flat', doorSides: ['w'], trimColor: 0xd84a4a, baseY: dg + 0.2 });
  b.sign(163.8, 20, -Math.PI / 2, 'HALFWAY DINER', 7, dg + 3.3, '#ff5a5a');
  b.prop('car', 158, null, 12, 0.3, 0x2c6f8b);
  b.prop('car', 160, null, 30, 2.8, 0xc2b280);
}

function scatterNature(b: MapBuilder, rng: Rng, noise: ValueNoise2D): void {
  const forest = new ValueNoise2D('hollow-forest');
  const blocked = (x: number, z: number, pad: number): boolean => {
    for (const p of POIS) if (Math.hypot(x - p.x, z - p.z) < p.radius * 0.85 + pad) return true;
    for (const c of COMPOUNDS) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 4) return true;
    if (Math.hypot(x - QUARRY.x, z - QUARRY.z) < QUARRY.r + 8) return true;
    for (const r of ROADS) {
      for (let i = 0; i < r.length - 1; i++) {
        if (distToSegment(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]) < 6) return true;
      }
    }
    return false;
  };
  const step = 7.5;
  const limit = HR_HALF - 12;
  for (let x = -limit; x < limit; x += step) {
    for (let z = -limit; z < limit; z += step) {
      const px = x + rng.range(0, step);
      const pz = z + rng.range(0, step);
      const f = forest.fbm(px / 70, pz / 70, 3);
      const p = f > 0.08 ? 0.72 : f > -0.1 ? 0.14 : 0.03;
      if (!rng.chance(p)) continue;
      if (blocked(px, pz, 2)) continue;
      const kind = noise.sample(px / 50, pz / 50) > -0.1 ? 'pine' : 'oak';
      b.tree(kind, px, pz, rng.range(0.85, 1.35), rng.range(0, Math.PI * 2));
    }
  }
  // Trees around POIs edges for framing
  for (const p of POIS) {
    for (let i = 0; i < 10; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = p.radius + rng.range(4, 14);
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (!blocked(x, z, -p.radius * 0.1) && Math.abs(x) < limit && Math.abs(z) < limit) b.tree(rng.chance(0.6) ? 'pine' : 'oak', x, z, rng.range(0.9, 1.3), a);
    }
  }
  // Rocks & boulders
  for (let i = 0; i < 110; i++) {
    const x = rng.range(-limit, limit);
    const z = rng.range(-limit, limit);
    if (blocked(x, z, 1)) continue;
    b.rock(x, z, rng.range(0.8, 2.6), rng.range(0, 6.28));
  }
  // Roadside wrecks
  for (let i = 0; i < 6; i++) {
    const road = ROADS[i % ROADS.length];
    const seg = rng.int(0, road.length - 2);
    const t = rng.range(0.3, 0.7);
    const x = road[seg][0] + (road[seg + 1][0] - road[seg][0]) * t + rng.range(-4, 4);
    const z = road[seg][1] + (road[seg + 1][1] - road[seg][1]) * t + rng.range(-4, 4);
    b.prop('car', x, null, z, rng.range(0, 6.28), rng.pick([0x7a2f2a, 0x3b73c4, 0xd9d4c7, 0x3f6b4a, 0x505a63]));
  }
  // Scattered loot in the wild
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-limit + 20, limit - 20);
    const z = rng.range(-limit + 20, limit - 20);
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r) continue;
    b.lootSpots.push([x, b.ground(x, z) + 0.1, z]);
  }
  // Supply caches (chests) in the wild near rocks
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-limit + 30, limit - 30);
    const z = rng.range(-limit + 30, limit - 30);
    if (blocked(x, z, 2)) continue;
    b.chests.push({ x, y: b.ground(x, z), z, rotY: rng.range(0, 6.28), kind: 'chest' });
  }
}
