import { Heightfield } from '../physics/terrain';
import type { SurfaceMaterial } from '../physics/collision';
import type { MapId } from '../game/matchTypes';
import type { ChestSpec, DecoShape, DoorSpec, MapData, POI, Region, ResourceSpec, RoofSpec, SignSpec, StaticBox } from './mapTypes';

export const C = {
  white: 0xece6da,
  cream: 0xe8d9b5,
  brick: 0xa4513c,
  brickDark: 0x7d3b2c,
  wood: 0x8a5a35,
  woodLight: 0xb98552,
  woodDark: 0x5b3a22,
  roofRed: 0xb3452f,
  roofBlue: 0x3f5f86,
  roofGreen: 0x4f6d3d,
  roofGrey: 0x5b6068,
  concrete: 0xa7a9ab,
  concreteDark: 0x76797d,
  asphalt: 0x3d4045,
  metal: 0x8d99a6,
  metalDark: 0x56606b,
  rust: 0xa45a2a,
  yellow: 0xf2b634,
  orange: 0xef7d2d,
  teal: 0x2bb3b1,
  cyan: 0x5ee7ff,
  glass: 0x9fd8ee,
  stone: 0x9a9384,
  stoneDark: 0x6e695e,
  moss: 0x5d7a3a,
  green: 0x4f8f47,
  red: 0xc9443a,
  blue: 0x3b73c4,
  navy: 0x22324a,
  black: 0x1d2024,
  sand: 0xd9c38f,
};

export interface Opening {
  /** Distance along the wall from its start. */
  start: number;
  end: number;
  bottom: number;
  top: number;
  door?: boolean;
}

/** Imperative helper that accumulates map content. */
export class MapBuilder {
  boxes: StaticBox[] = [];
  decos: DecoShape[] = [];
  roofs: RoofSpec[] = [];
  resources: ResourceSpec[] = [];
  doors: DoorSpec[] = [];
  chests: ChestSpec[] = [];
  lootSpots: [number, number, number][] = [];
  signs: SignSpec[] = [];
  lights: MapData['lights'] = [];
  pois: POI[] = [];
  regions: Region[] = [];
  spawns: [number, number][] = [];
  barriers: StaticBox[] = [];

  constructor(public terrain: Heightfield) {}

  ground(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, opts: { collide?: boolean; material?: SurfaceMaterial; glass?: boolean; emissive?: boolean } = {}): void {
    this.boxes.push({
      min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
      max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
      color,
      collide: opts.collide ?? true,
      material: opts.material ?? 'concrete',
      glass: opts.glass,
      emissive: opts.emissive,
    });
  }

  /** Box by centre-bottom and size. */
  block(cx: number, y: number, cz: number, sx: number, sy: number, sz: number, color: number, opts: { collide?: boolean; material?: SurfaceMaterial; glass?: boolean; emissive?: boolean } = {}): void {
    this.box(cx - sx / 2, y, cz - sz / 2, cx + sx / 2, y + sy, cz + sz / 2, color, opts);
  }

  deco(shape: DecoShape['shape'], pos: [number, number, number], size: [number, number, number], color: number, rot: [number, number, number] = [0, 0, 0], extra: Partial<DecoShape> = {}): void {
    this.decos.push({ shape, pos, size, rot, color, ...extra });
  }

  /**
   * A straight wall with openings (doors / windows). axis 'x' runs along X at
   * constant z; axis 'z' runs along Z at constant x.
   */
  wall(axis: 'x' | 'z', fixed: number, from: number, to: number, y0: number, height: number, thick: number, color: number, openings: Opening[] = [], material: SurfaceMaterial = 'concrete'): void {
    const len = to - from;
    const sorted = [...openings].sort((a, b) => a.start - b.start);
    let cursor = 0;
    const seg = (a: number, b: number, ya: number, yb: number) => {
      if (b - a < 0.01 || yb - ya < 0.01) return;
      if (axis === 'x') this.box(from + a, y0 + ya, fixed - thick / 2, from + b, y0 + yb, fixed + thick / 2, color, { material });
      else this.box(fixed - thick / 2, y0 + ya, from + a, fixed + thick / 2, y0 + yb, from + b, color, { material });
    };
    for (const o of sorted) {
      seg(cursor, o.start, 0, height);
      seg(o.start, o.end, 0, o.bottom);
      seg(o.start, o.end, o.top, height);
      if (o.door) {
        const mid = from + (o.start + o.end) / 2;
        if (axis === 'x') this.doors.push({ x: mid, y: y0, z: fixed, axis: 0, width: o.end - o.start, height: o.top - o.bottom, color: C.woodDark });
        else this.doors.push({ x: fixed, y: y0, z: mid, axis: 1, width: o.end - o.start, height: o.top - o.bottom, color: C.woodDark });
      } else if (o.bottom > 0.2) {
        // Window frame trim (visual).
        const mid = from + (o.start + o.end) / 2;
        const w = o.end - o.start;
        if (axis === 'x') this.deco('box', [mid, y0 + o.bottom - 0.06, fixed], [w + 0.2, 0.12, thick + 0.12], C.white);
        else this.deco('box', [fixed, y0 + o.bottom - 0.06, mid], [thick + 0.12, 0.12, w + 0.2], C.white);
      }
      cursor = o.end;
    }
    seg(cursor, len, 0, height);
  }

  /** Horizontal slab with an optional rectangular hole (for stairs). */
  slab(x0: number, z0: number, x1: number, z1: number, y: number, thick: number, color: number, hole?: [number, number, number, number]): void {
    if (!hole) {
      this.box(x0, y - thick, z0, x1, y, z1, color);
      return;
    }
    const [hx0, hz0, hx1, hz1] = hole;
    this.box(x0, y - thick, z0, x1, y, hz0, color);
    this.box(x0, y - thick, hz1, x1, y, z1, color);
    this.box(x0, y - thick, hz0, hx0, y, hz1, color);
    this.box(hx1, y - thick, hz0, x1, y, hz1, color);
  }

  /** Straight staircase rising along +dir from (x, y, z). */
  stairs(x: number, y: number, z: number, dir: 'x' | 'z' | '-x' | '-z', width: number, rise: number, color: number): [number, number, number, number] {
    const steps = Math.ceil(rise / 0.38);
    const stepH = rise / steps;
    const run = 0.42;
    for (let i = 0; i < steps; i++) {
      const a = i * run;
      const b = (i + 1) * run;
      const top = y + (i + 1) * stepH;
      switch (dir) {
        case 'x':
          this.box(x + a, y, z - width / 2, x + b, top, z + width / 2, color);
          break;
        case '-x':
          this.box(x - b, y, z - width / 2, x - a, top, z + width / 2, color);
          break;
        case 'z':
          this.box(x - width / 2, y, z + a, x + width / 2, top, z + b, color);
          break;
        case '-z':
          this.box(x - width / 2, y, z - b, x + width / 2, top, z - a, color);
          break;
      }
    }
    const total = steps * run;
    switch (dir) {
      case 'x':
        return [x, z - width / 2, x + total, z + width / 2];
      case '-x':
        return [x - total, z - width / 2, x, z + width / 2];
      case 'z':
        return [x - width / 2, z, x + width / 2, z + total];
      default:
        return [x - width / 2, z - total, x + width / 2, z];
    }
  }

  gableRoof(x0: number, z0: number, x1: number, z1: number, y: number, peak: number, ridge: 'x' | 'z', color: number): void {
    this.roofs.push({ x0, z0, x1, z1, y, peak, ridge, color });
  }

  /**
   * A furnished house / building shell. Returns interior info so callers can
   * add loot. Doors are added on the requested sides.
   */
  house(opts: {
    x: number;
    z: number;
    w: number;
    d: number;
    floors?: number;
    wallColor: number;
    trimColor?: number;
    roof?: 'gable' | 'flat';
    roofColor?: number;
    doorSides?: ('n' | 's' | 'e' | 'w')[];
    windows?: boolean;
    floorColor?: number;
    baseY?: number;
    chest?: boolean;
    material?: SurfaceMaterial;
  }): { y: number; storyH: number; floors: number } {
    const { x, z, w, d } = opts;
    const floors = opts.floors ?? 1;
    const storyH = 3.4;
    const t = 0.3;
    const y = opts.baseY ?? this.foundation(x, z, w, d);
    const x0 = x - w / 2;
    const x1 = x + w / 2;
    const z0 = z - d / 2;
    const z1 = z + d / 2;
    const doorSides = opts.doorSides ?? ['s'];
    const mat = opts.material ?? 'concrete';
    // Floor
    this.box(x0, y - 0.3, z0, x1, y + 0.05, z1, opts.floorColor ?? C.woodLight, { material: 'wood' });
    let stairHole: [number, number, number, number] | undefined;
    for (let f = 0; f < floors; f++) {
      const fy = y + f * storyH;
      const winOpenings = (len: number, door: boolean): Opening[] => {
        const res: Opening[] = [];
        if (door && f === 0) res.push({ start: len / 2 - 0.85, end: len / 2 + 0.85, bottom: 0, top: 2.5, door: true });
        if (opts.windows !== false) {
          if (len >= 7) {
            res.push({ start: 1.0, end: 2.4, bottom: 1.1, top: 2.3 });
            res.push({ start: len - 2.4, end: len - 1.0, bottom: 1.1, top: 2.3 });
          } else if (!door || f > 0) {
            res.push({ start: len / 2 - 0.7, end: len / 2 + 0.7, bottom: 1.1, top: 2.3 });
          }
        }
        return res;
      };
      this.wall('x', z1, x0, x1, fy, storyH, t, opts.wallColor, winOpenings(w, doorSides.includes('s')), mat);
      this.wall('x', z0, x0, x1, fy, storyH, t, opts.wallColor, winOpenings(w, doorSides.includes('n')), mat);
      this.wall('z', x1, z0 + t / 2, z1 - t / 2, fy, storyH, t, opts.wallColor, winOpenings(d - t, doorSides.includes('e')), mat);
      this.wall('z', x0, z0 + t / 2, z1 - t / 2, fy, storyH, t, opts.wallColor, winOpenings(d - t, doorSides.includes('w')), mat);
      if (f > 0) this.slab(x0 + t / 2, z0 + t / 2, x1 - t / 2, z1 - t / 2, fy, 0.25, opts.floorColor ?? C.woodLight, stairHole);
      if (f < floors - 1) {
        // Stairs along the west wall rising north (−z).
        stairHole = this.stairs(x0 + 1.0, fy, z1 - 0.6, '-z', 1.3, storyH, C.wood);
        stairHole = [stairHole[0] - 0.1, stairHole[1] - 0.1, stairHole[2] + 0.1, stairHole[3]];
      }
      if (opts.trimColor !== undefined) {
        this.deco('box', [x, fy + storyH - 0.05, z1 + 0.18], [w + 0.1, 0.18, 0.06], opts.trimColor);
        this.deco('box', [x, fy + storyH - 0.05, z0 - 0.18], [w + 0.1, 0.18, 0.06], opts.trimColor);
      }
    }
    const topY = y + floors * storyH;
    if ((opts.roof ?? 'gable') === 'gable') {
      this.box(x0, topY - 0.2, z0, x1, topY, z1, opts.floorColor ?? C.woodLight, { material: 'wood' });
      const ridge = w >= d ? 'x' : 'z';
      this.gableRoof(x0 - 0.5, z0 - 0.5, x1 + 0.5, z1 + 0.5, topY, Math.min(w, d) * 0.32, ridge, opts.roofColor ?? C.roofRed);
    } else {
      this.box(x0, topY - 0.25, z0, x1, topY, z1, C.concreteDark);
      // Parapet
      this.box(x0, topY, z0, x1, topY + 0.6, z0 + 0.25, opts.wallColor);
      this.box(x0, topY, z1 - 0.25, x1, topY + 0.6, z1, opts.wallColor);
      this.box(x0, topY, z0, x0 + 0.25, topY + 0.6, z1, opts.wallColor);
      this.box(x1 - 0.25, topY, z0, x1, topY + 0.6, z1, opts.wallColor);
    }
    // Loot inside: one floor spot per storey, chest on upper storey.
    for (let f = 0; f < floors; f++) {
      const fy = y + f * storyH + 0.1;
      this.lootSpots.push([x + w * 0.2, fy, z - d * 0.15]);
      if ((opts.chest ?? true) && (f === floors - 1)) this.chests.push({ x: x1 - 1.1, y: fy - 0.05, z: z0 + 1.1, rotY: Math.PI / 2, kind: 'chest' });
    }
    return { y, storyH, floors };
  }

  /** Raise a foundation plinth so buildings sit level on uneven terrain. Returns floor height. */
  foundation(x: number, z: number, w: number, d: number): number {
    let maxH = -Infinity;
    let minH = Infinity;
    for (const [sx, sz] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
      [0, 0],
    ]) {
      const h = this.ground(x + sx * w, z + sz * d);
      maxH = Math.max(maxH, h);
      minH = Math.min(minH, h);
    }
    const y = maxH + 0.15;
    if (y - minH > 0.3) this.box(x - w / 2 - 0.2, minH - 0.5, z - d / 2 - 0.2, x + w / 2 + 0.2, y - 0.3, z + d / 2 + 0.2, C.stoneDark, { material: 'stone' });
    return y;
  }

  tree(kind: 'pine' | 'oak', x: number, z: number, scale: number, rotY = 0): void {
    this.resources.push({ kind, x, y: this.ground(x, z), z, scale, rotY });
  }

  rock(x: number, z: number, scale: number, rotY = 0): void {
    this.resources.push({ kind: 'rock', x, y: this.ground(x, z) - 0.3 * scale, z, scale, rotY });
  }

  prop(kind: 'crate' | 'barrel' | 'car', x: number, y: number | null, z: number, rotY = 0, color?: number): void {
    this.resources.push({ kind, x, y: y ?? this.ground(x, z), z, scale: 1, rotY, color });
  }

  sign(x: number, z: number, rotY: number, text: string, width = 5, y?: number, color?: string): void {
    const gy = y ?? this.ground(x, z);
    if (y === undefined) {
      this.deco('box', [x - width * 0.35, gy + 1.2, z], [0.15, 2.4, 0.15], C.woodDark, [0, rotY, 0]);
    }
    this.signs.push({ x, y: gy + (y === undefined ? 2.4 : 0), z, rotY, text, width, color });
  }

  fence(x0: number, z0: number, x1: number, z1: number, color = C.woodLight, broken = false): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / 2.5));
    const rot = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const g = this.ground(x, z);
      this.deco('box', [x, g + 0.55, z], [0.14, 1.1, 0.14], color);
      if (i < n && !(broken && i % 3 === 1)) {
        const mx = x + (x1 - x0) / n / 2;
        const mz = z + (z1 - z0) / n / 2;
        const mg = this.ground(mx, mz);
        this.deco('box', [mx, mg + 0.75, mz], [0.06, 0.12, len / n], color, [0, rot, 0]);
        this.deco('box', [mx, mg + 0.4, mz], [0.06, 0.12, len / n], color, [0, rot, 0]);
      }
    }
  }

  lamp(x: number, z: number, color = 0xffd9a0): void {
    const g = this.ground(x, z);
    this.deco('cyl', [x, g + 2.5, z], [0.08, 5, 0.08], C.metalDark);
    this.deco('box', [x, g + 5, z], [0.5, 0.2, 0.5], C.metalDark);
    this.deco('box', [x, g + 4.85, z], [0.35, 0.08, 0.35], color, [0, 0, 0], { emissive: true });
  }

  finish(id: MapId, name: string, half: number, extra: Partial<MapData> = {}): MapData {
    return {
      id,
      name,
      half,
      terrain: this.terrain,
      waterLevel: null,
      water: null,
      boxes: this.boxes,
      decos: this.decos,
      roofs: this.roofs,
      resources: this.resources,
      doors: this.doors,
      chests: this.chests,
      lootSpots: this.lootSpots,
      signs: this.signs,
      lights: this.lights,
      pois: this.pois,
      regions: this.regions,
      spawns: this.spawns,
      barriers: this.barriers,
      palette: { grass: 0x6fa24a, grass2: 0x8cb85a, dirt: 0x9b7b52, rock: 0x8a857a, sand: 0xd8c690, road: 0x4a4b4f },
      fogDensity: 0.0032,
      ...extra,
    };
  }
}

export function makeTerrain(half: number, spacing: number, fn: (x: number, z: number) => number): Heightfield {
  const hf = new Heightfield(-half, -half, half * 2, half * 2, spacing);
  hf.fill(fn);
  return hf;
}

/** Distance from point to segment on XZ. */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
