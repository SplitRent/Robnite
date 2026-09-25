import { Vector3 } from 'three';
import { CollisionWorld, makeAABB, type Collider } from '../physics/collision';
import type { BuildMaterial } from '../building/grid';
import type { ItemStack } from '../inventory/items';
import type { ChestSpec, DoorSpec, MapData, ResourceKind, ResourceSpec } from '../map/mapTypes';

export interface ResourceNode {
  id: number;
  spec: ResourceSpec;
  health: number;
  maxHealth: number;
  material: BuildMaterial;
  yieldPerHit: number;
  alive: boolean;
  collider: Collider;
  /** Last time it was hit (for the wobble animation). */
  hitAt: number;
}

export interface Door {
  id: number;
  spec: DoorSpec;
  open: boolean;
  collider: Collider;
}

export interface Chest {
  id: number;
  spec: ChestSpec;
  opened: boolean;
}

export interface GroundItem {
  id: number;
  item: ItemStack;
  pos: Vector3;
  vel: Vector3;
  settled: boolean;
  spawnedAt: number;
}

export const RESOURCE_INFO: Record<ResourceKind, { health: number; material: BuildMaterial; yield: number }> = {
  pine: { health: 180, material: 'wood', yield: 10 },
  oak: { health: 220, material: 'wood', yield: 11 },
  rock: { health: 300, material: 'stone', yield: 9 },
  crate: { health: 60, material: 'wood', yield: 12 },
  barrel: { health: 100, material: 'metal', yield: 8 },
  car: { health: 350, material: 'metal', yield: 10 },
};

/** Runtime world: collision + interactive entities built from static map data. */
export class WorldState {
  readonly collision: CollisionWorld;
  readonly resources: ResourceNode[] = [];
  readonly doors: Door[] = [];
  readonly chests: Chest[] = [];
  readonly items = new Map<number, GroundItem>();
  readonly barrierColliders: Collider[] = [];
  private nextItemId = 1;
  private resourceByCollider = new Map<number, ResourceNode>();
  private doorByCollider = new Map<number, Door>();

  constructor(readonly map: MapData) {
    const w = new CollisionWorld(map.terrain);
    const h = map.half - 1;
    w.bounds = makeAABB(-h, -60, -h, h, 260, h);
    this.collision = w;
    for (const b of map.boxes) {
      if (!b.collide) continue;
      w.addBox(makeAABB(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]), 'static', 0, b.material, !b.glass);
    }
    for (const r of map.roofs) {
      const box = makeAABB(r.x0, r.y - 0.1, r.z0, r.x1, r.y + r.peak + 0.1, r.z1);
      const ridgeX = r.ridge === 'x';
      const mid = ridgeX ? (r.z0 + r.z1) / 2 : (r.x0 + r.x1) / 2;
      const halfSpan = ridgeX ? (r.z1 - r.z0) / 2 : (r.x1 - r.x0) / 2;
      w.addSurface(box, (x, z) => {
        if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) return null;
        const d = Math.abs((ridgeX ? z : x) - mid) / halfSpan;
        return r.y + r.peak * (1 - Math.min(1, d));
      }, 'static', 0, 'wood');
    }
    for (const b of map.barriers) {
      this.barrierColliders.push(w.addBox(makeAABB(b.min[0], b.min[1], b.min[2], b.max[0], b.max[1], b.max[2]), 'bound', 0, 'glass', false));
    }
    map.resources.forEach((spec, i) => this.addResource(spec, i));
    map.doors.forEach((spec, i) => {
      const half = spec.width / 2;
      const t = 0.12;
      const box = spec.axis === 0
        ? makeAABB(spec.x - half, spec.y, spec.z - t, spec.x + half, spec.y + spec.height, spec.z + t)
        : makeAABB(spec.x - t, spec.y, spec.z - half, spec.x + t, spec.y + spec.height, spec.z + half);
      const collider = w.addBox(box, 'door', i, 'wood');
      const door: Door = { id: i, spec, open: false, collider };
      this.doors.push(door);
      this.doorByCollider.set(collider.id, door);
    });
    map.chests.forEach((spec, i) => this.chests.push({ id: i, spec, opened: false }));
  }

  private addResource(spec: ResourceSpec, id: number): void {
    const info = RESOURCE_INFO[spec.kind];
    const s = spec.scale;
    let box;
    switch (spec.kind) {
      case 'pine':
      case 'oak':
        box = makeAABB(spec.x - 0.35 * s, spec.y - 1, spec.z - 0.35 * s, spec.x + 0.35 * s, spec.y + 7.5 * s, spec.z + 0.35 * s);
        break;
      case 'rock':
        box = makeAABB(spec.x - 1.1 * s, spec.y - 1, spec.z - 1.1 * s, spec.x + 1.1 * s, spec.y + 1.5 * s, spec.z + 1.1 * s);
        break;
      case 'crate':
        box = makeAABB(spec.x - 0.6, spec.y, spec.z - 0.6, spec.x + 0.6, spec.y + 1.2, spec.z + 0.6);
        break;
      case 'barrel':
        box = makeAABB(spec.x - 0.4, spec.y, spec.z - 0.4, spec.x + 0.4, spec.y + 1.2, spec.z + 0.4);
        break;
      case 'car': {
        const c = Math.abs(Math.cos(spec.rotY));
        const sn = Math.abs(Math.sin(spec.rotY));
        const hx = (2.1 * sn + 0.95 * c) * 0.95;
        const hz = (2.1 * c + 0.95 * sn) * 0.95;
        box = makeAABB(spec.x - hx, spec.y, spec.z - hz, spec.x + hx, spec.y + 1.45, spec.z + hz);
        break;
      }
    }
    const collider = this.collision.addBox(box, 'resource', id, info.material === 'wood' ? 'wood' : info.material === 'stone' ? 'stone' : 'metal');
    const maxHealth = info.health * (spec.kind === 'rock' ? Math.max(0.6, spec.scale * 0.6) : 1);
    const node: ResourceNode = { id, spec, health: maxHealth, maxHealth, material: info.material, yieldPerHit: info.yield, alive: true, collider, hitAt: -9 };
    this.resources.push(node);
    this.resourceByCollider.set(collider.id, node);
  }

  resourceFromCollider(c: Collider | null | undefined): ResourceNode | undefined {
    return c ? this.resourceByCollider.get(c.id) : undefined;
  }

  doorFromCollider(c: Collider | null | undefined): Door | undefined {
    return c ? this.doorByCollider.get(c.id) : undefined;
  }

  destroyResource(node: ResourceNode): void {
    if (!node.alive) return;
    node.alive = false;
    this.collision.remove(node.collider);
  }

  setDoor(door: Door, open: boolean): void {
    door.open = open;
    door.collider.enabled = !open;
  }

  removeBarriers(): void {
    for (const c of this.barrierColliders) c.enabled = false;
  }

  restoreBarriers(): void {
    for (const c of this.barrierColliders) c.enabled = true;
  }

  spawnItem(item: ItemStack, pos: { x: number; y: number; z: number }, pop = false, time = 0): GroundItem {
    const g: GroundItem = {
      id: this.nextItemId++,
      item,
      pos: new Vector3(pos.x, pos.y, pos.z),
      vel: pop ? new Vector3((Math.random() - 0.5) * 3, 4.5, (Math.random() - 0.5) * 3) : new Vector3(),
      settled: !pop,
      spawnedAt: time,
    };
    this.items.set(g.id, g);
    return g;
  }

  /** Simple ballistic settle for popped items. */
  updateItems(dt: number): void {
    for (const it of this.items.values()) {
      if (it.settled) continue;
      it.vel.y -= 20 * dt;
      it.pos.addScaledVector(it.vel, dt);
      const ground = this.supportHeight(it.pos.x, it.pos.z, it.pos.y + 0.5);
      if (it.pos.y <= ground) {
        it.pos.y = ground;
        it.settled = true;
        it.vel.set(0, 0, 0);
      }
    }
  }

  /** Water surface height at x,z, or null when there is no water there. */
  waterAt(x: number, z: number): number | null {
    const w = this.map.water;
    if (!w || this.map.waterLevel === null) return null;
    return Math.hypot(x - w.x, z - w.z) <= w.radius ? this.map.waterLevel : null;
  }

  /** Highest walkable height at x,z not above maxY. */
  supportHeight(x: number, z: number, maxY: number): number {
    let best = this.collision.terrainHeight(x, z);
    const list = this.collision.query(makeAABB(x - 0.05, best - 0.1, z - 0.05, x + 0.05, maxY, z + 0.05));
    for (const c of list) {
      const top = c.kind === 'box' ? c.box.maxY : c.height(x, z);
      if (top !== null && top <= maxY + 0.01 && top > best) best = top;
    }
    return best;
  }
}
