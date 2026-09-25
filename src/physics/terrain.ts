import { Vector3 } from 'three';

/**
 * Regular-grid heightfield. Samples are stored row-major (z rows, x columns)
 * and bilinearly interpolated. The whole map ground is one heightfield, which
 * keeps collision and raycasts cheap.
 */
export class Heightfield {
  readonly heights: Float32Array;
  readonly cols: number;
  readonly rows: number;
  minHeight = Infinity;
  maxHeight = -Infinity;

  constructor(
    readonly originX: number,
    readonly originZ: number,
    readonly width: number,
    readonly depth: number,
    readonly spacing: number,
  ) {
    this.cols = Math.round(width / spacing) + 1;
    this.rows = Math.round(depth / spacing) + 1;
    this.heights = new Float32Array(this.cols * this.rows);
  }

  fill(fn: (x: number, z: number) => number): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const h = fn(this.originX + c * this.spacing, this.originZ + r * this.spacing);
        this.heights[r * this.cols + c] = h;
      }
    }
    this.recomputeBounds();
  }

  recomputeBounds(): void {
    this.minHeight = Infinity;
    this.maxHeight = -Infinity;
    for (const h of this.heights) {
      if (h < this.minHeight) this.minHeight = h;
      if (h > this.maxHeight) this.maxHeight = h;
    }
  }

  sampleAt(c: number, r: number): number {
    c = c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
    r = r < 0 ? 0 : r >= this.rows ? this.rows - 1 : r;
    return this.heights[r * this.cols + c];
  }

  heightAt(x: number, z: number): number {
    const fx = (x - this.originX) / this.spacing;
    const fz = (z - this.originZ) / this.spacing;
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const h00 = this.sampleAt(c, r);
    const h10 = this.sampleAt(c + 1, r);
    const h01 = this.sampleAt(c, r + 1);
    const h11 = this.sampleAt(c + 1, r + 1);
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  normalAt(x: number, z: number, out = new Vector3()): Vector3 {
    const e = this.spacing * 0.5;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  /** Ray march + bisection. Returns distance along ray or -1. */
  raycast(origin: Vector3, dir: Vector3, maxDist: number): number {
    let t = 0;
    let end = maxDist;
    // Skip the part of the ray that is entirely above the highest sample.
    if (origin.y > this.maxHeight) {
      if (dir.y >= 0) return -1;
      t = Math.max(0, (origin.y - this.maxHeight) / -dir.y - 0.01);
    }
    if (dir.y > 0 && origin.y + dir.y * end > this.maxHeight) {
      end = Math.min(end, Math.max(0, (this.maxHeight - origin.y) / dir.y) + 0.01);
      if (origin.y > this.maxHeight) return -1;
    }
    if (t > end) return -1;
    const step = Math.max(0.35, this.spacing * 0.45);
    let prevT = t;
    let prevD = origin.y + dir.y * t - this.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
    if (prevD < 0) return t;
    while (t < end) {
      t = Math.min(end, t + step);
      const d = origin.y + dir.y * t - this.heightAt(origin.x + dir.x * t, origin.z + dir.z * t);
      if (d <= 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5;
          const dm = origin.y + dir.y * mid - this.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (dm > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      prevT = t;
      prevD = d;
      if (t >= end) break;
    }
    void prevD;
    return -1;
  }
}
