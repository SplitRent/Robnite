import { Rng } from '../core/rng';

export interface StormPhaseDef {
  /** Seconds before the circle starts moving. */
  wait: number;
  /** Seconds to shrink to the next radius. */
  shrink: number;
  radius: number;
  /** Damage per second outside the safe zone during this phase. */
  dps: number;
}

export const BR_STORM: StormPhaseDef[] = [
  { wait: 50, shrink: 40, radius: 150, dps: 1 },
  { wait: 35, shrink: 35, radius: 95, dps: 2 },
  { wait: 30, shrink: 30, radius: 55, dps: 4 },
  { wait: 25, shrink: 25, radius: 28, dps: 7 },
  { wait: 20, shrink: 20, radius: 12, dps: 10 },
  { wait: 12, shrink: 25, radius: 0, dps: 14 },
];

export const ZONEWAR_STORM: StormPhaseDef[] = [
  { wait: 12, shrink: 20, radius: 55, dps: 2 },
  { wait: 12, shrink: 18, radius: 30, dps: 4 },
  { wait: 10, shrink: 16, radius: 14, dps: 7 },
  { wait: 8, shrink: 15, radius: 4, dps: 10 },
  { wait: 5, shrink: 12, radius: 0, dps: 14 },
];

export type StormStage = 'wait' | 'shrink' | 'done';

/** Shrinking safe zone. Deterministic from its seed. */
export class Storm {
  centerX = 0;
  centerZ = 0;
  radius: number;
  nextX = 0;
  nextZ = 0;
  nextRadius: number;
  phase = 0;
  stage: StormStage = 'wait';
  timer: number;
  private fromX = 0;
  private fromZ = 0;
  private fromR = 0;
  private rng: Rng;
  active = true;

  constructor(
    readonly phases: StormPhaseDef[],
    initialRadius: number,
    seed: number,
    private limit: number,
    private validCenter: (x: number, z: number) => boolean = () => true,
  ) {
    this.rng = new Rng(seed);
    this.radius = initialRadius;
    this.nextRadius = initialRadius;
    this.timer = phases[0].wait;
    this.pickNext();
  }

  private pickNext(): void {
    const def = this.phases[this.phase];
    if (!def) return;
    const slack = Math.max(0, this.radius - def.radius);
    for (let i = 0; i < 20; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * slack * 0.85;
      let x = this.centerX + Math.cos(a) * r;
      let z = this.centerZ + Math.sin(a) * r;
      const lim = this.limit - def.radius * 0.5;
      x = Math.max(-lim, Math.min(lim, x));
      z = Math.max(-lim, Math.min(lim, z));
      this.nextX = x;
      this.nextZ = z;
      if (this.validCenter(x, z)) break;
    }
    this.nextRadius = def.radius;
  }

  get dps(): number {
    const def = this.phases[Math.min(this.phase, this.phases.length - 1)];
    return def ? def.dps : 1;
  }

  get isFinal(): boolean {
    return this.phase >= this.phases.length - 2;
  }

  update(dt: number): { event: 'shrinkStart' | 'phaseEnd' | null } {
    if (!this.active || this.stage === 'done') return { event: null };
    this.timer -= dt;
    let event: 'shrinkStart' | 'phaseEnd' | null = null;
    if (this.stage === 'wait') {
      if (this.timer <= 0) {
        this.stage = 'shrink';
        this.timer = this.phases[this.phase].shrink;
        this.fromX = this.centerX;
        this.fromZ = this.centerZ;
        this.fromR = this.radius;
        event = 'shrinkStart';
      }
    } else if (this.stage === 'shrink') {
      const def = this.phases[this.phase];
      const t = 1 - Math.max(0, this.timer) / def.shrink;
      this.centerX = this.fromX + (this.nextX - this.fromX) * t;
      this.centerZ = this.fromZ + (this.nextZ - this.fromZ) * t;
      this.radius = this.fromR + (this.nextRadius - this.fromR) * t;
      if (this.timer <= 0) {
        this.centerX = this.nextX;
        this.centerZ = this.nextZ;
        this.radius = this.nextRadius;
        this.phase++;
        event = 'phaseEnd';
        if (this.phase >= this.phases.length) {
          this.stage = 'done';
        } else {
          this.stage = 'wait';
          this.timer = this.phases[this.phase].wait;
          this.pickNext();
        }
      }
    }
    return { event };
  }

  isInside(x: number, z: number): boolean {
    return Math.hypot(x - this.centerX, z - this.centerZ) <= this.radius;
  }

  distanceOutside(x: number, z: number): number {
    return Math.hypot(x - this.centerX, z - this.centerZ) - this.radius;
  }
}
