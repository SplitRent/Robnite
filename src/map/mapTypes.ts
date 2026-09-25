import type { SurfaceMaterial } from '../physics/collision';
import type { Heightfield } from '../physics/terrain';
import type { MapId } from '../game/matchTypes';

export interface StaticBox {
  min: [number, number, number];
  max: [number, number, number];
  color: number;
  collide: boolean;
  material: SurfaceMaterial;
  /** Glass: collides with players but bullets pass through. */
  glass?: boolean;
  emissive?: boolean;
}

/** Visual-only rotated box or cylinder. */
export interface DecoShape {
  shape: 'box' | 'cyl' | 'cone' | 'sphere';
  pos: [number, number, number];
  size: [number, number, number];
  rot: [number, number, number];
  color: number;
  emissive?: boolean;
  segments?: number;
}

/** Pitched (gable) roof: a walkable surface and a prism mesh. */
export interface RoofSpec {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Eave height. */
  y: number;
  peak: number;
  /** Ridge runs along this axis. */
  ridge: 'x' | 'z';
  color: number;
}

export type ResourceKind = 'pine' | 'oak' | 'rock' | 'crate' | 'barrel' | 'car';

export interface ResourceSpec {
  kind: ResourceKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  color?: number;
}

export interface DoorSpec {
  x: number;
  y: number;
  z: number;
  /** 0: door blocks along the X axis (in a wall of constant Z); 1: in a wall of constant X. */
  axis: 0 | 1;
  width: number;
  height: number;
  color: number;
}

export interface ChestSpec {
  x: number;
  y: number;
  z: number;
  rotY: number;
  kind: 'chest' | 'supply';
}

export interface SignSpec {
  x: number;
  y: number;
  z: number;
  rotY: number;
  text: string;
  width: number;
  color?: string;
}

export interface PointLightSpec {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

export interface POI {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  /** Loot quality 0..1, used by bots when choosing landing spots. */
  lootValue: number;
}

export interface Region {
  kind: 'road' | 'dirt' | 'sand' | 'concrete' | 'gravel';
  /** Polyline for roads, or a circle via centre + radius. */
  points?: [number, number][];
  cx?: number;
  cz?: number;
  radius: number;
}

export interface MapData {
  id: MapId;
  name: string;
  half: number;
  terrain: Heightfield;
  waterLevel: number | null;
  /** Circular water body (lake) — water only exists inside it. */
  water: { x: number; z: number; radius: number } | null;
  boxes: StaticBox[];
  decos: DecoShape[];
  roofs: RoofSpec[];
  resources: ResourceSpec[];
  doors: DoorSpec[];
  chests: ChestSpec[];
  lootSpots: [number, number, number][];
  signs: SignSpec[];
  lights: PointLightSpec[];
  pois: POI[];
  regions: Region[];
  /** Spawn positions (x, z) for non-deployment modes. */
  spawns: [number, number][];
  /** Grass / ground base colours for this biome. */
  palette: { grass: number; grass2: number; dirt: number; rock: number; sand: number; road: number };
  /** Barrier boxes that are removed when the match goes live. */
  barriers: StaticBox[];
  /** Default fog / sky tweak per map. */
  fogDensity: number;
}
