import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import type { CollisionWorld } from '../physics/collision';

export interface CameraSettings {
  fov: number;
  distance: number;
  shoulder: number;
  shake: boolean;
  reducedMotion: boolean;
}

/**
 * Over-the-shoulder third-person camera. Yaw/pitch come straight from the
 * mouse (no smoothing on rotation → zero input lag); the crosshair is the
 * exact centre of this camera. Position is collision-tested against the world.
 */
export class CameraController {
  readonly camera: PerspectiveCamera;
  yaw = 0;
  pitch = 0;
  /** Visual recoil offset (recovers over time). */
  recoilPitch = 0;
  recoilYaw = 0;
  private zoom = 1;
  private currentDist = 3;
  private fovBoost = 0;
  private shake = 0;
  private landDip = 0;
  private pivot = new Vector3();
  settings: CameraSettings = { fov: 80, distance: 3.2, shoulder: 0.65, shake: true, reducedMotion: false };
  /** Distance override (e.g. zoomed out while skydiving). */
  distanceOverride: number | null = null;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(80, aspect, 0.08, 2400);
  }

  addLook(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -1.45, 1.45);
  }

  addRecoil(pitch: number, yaw: number): void {
    this.recoilPitch += pitch;
    this.recoilYaw += yaw;
  }

  addShake(amount: number): void {
    if (!this.settings.shake || this.settings.reducedMotion) return;
    this.shake = Math.min(1, this.shake + amount);
  }

  landed(speed: number): void {
    if (this.settings.reducedMotion) return;
    this.landDip = Math.min(0.35, speed * 0.015);
  }

  /** Total aim angles including recoil. */
  get aimYaw(): number {
    return this.yaw + this.recoilYaw;
  }

  get aimPitch(): number {
    return clamp(this.pitch + this.recoilPitch, -1.5, 1.5);
  }

  update(dt: number, target: Vector3, eyeHeight: number, opts: { aiming: boolean; scoped: boolean; adsFov: number; sprinting: boolean; world: CollisionWorld | null; firstPerson?: boolean }): void {
    // Recoil recovery
    const rec = Math.exp(-9 * dt);
    this.recoilPitch *= rec;
    this.recoilYaw *= rec;
    this.landDip = damp(this.landDip, 0, 10, dt);
    this.zoom = damp(this.zoom, opts.aiming ? opts.adsFov : 1, 18, dt);
    this.fovBoost = damp(this.fovBoost, opts.sprinting && !opts.aiming && !this.settings.reducedMotion ? 6 : 0, 6, dt);
    this.shake = Math.max(0, this.shake - dt * 3);

    const yaw = this.aimYaw;
    const pitch = this.aimPitch;
    const fx = -Math.sin(yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * Math.cos(pitch);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);

    this.pivot.set(target.x, target.y + eyeHeight - this.landDip, target.z);
    const baseDist = this.distanceOverride ?? this.settings.distance;
    const wantDist = opts.firstPerson ? 0 : opts.scoped ? 0.4 : opts.aiming ? baseDist * 0.55 : baseDist;
    const shoulder = opts.firstPerson ? 0 : this.settings.shoulder * (opts.aiming ? 0.8 : 1);
    // Shoulder point, then back along the view direction.
    const sx = this.pivot.x + rx * shoulder;
    const sy = this.pivot.y + 0.1;
    const sz = this.pivot.z + rz * shoulder;
    let dist = wantDist;
    if (opts.world && wantDist > 0) {
      // Keep the shoulder point itself out of walls.
      const side = new Vector3(rx, 0, rz);
      const sHit = opts.world.raycast(new Vector3(this.pivot.x, sy, this.pivot.z), side, shoulder + 0.2, { includeTerrain: false });
      const effShoulder = sHit ? Math.max(0, sHit.t - 0.2) : shoulder;
      const origin = new Vector3(this.pivot.x + rx * effShoulder, sy, this.pivot.z + rz * effShoulder);
      const back = new Vector3(-fx, -fy, -fz);
      const hit = opts.world.raycast(origin, back, wantDist + 0.3, {});
      if (hit) dist = Math.max(0.3, hit.t - 0.25);
      this.currentDist = dist < this.currentDist ? dist : damp(this.currentDist, dist, 8, dt);
      this.camera.position.set(origin.x - fx * this.currentDist, origin.y - fy * this.currentDist, origin.z - fz * this.currentDist);
    } else {
      this.currentDist = dist;
      this.camera.position.set(sx - fx * dist, sy - fy * dist, sz - fz * dist);
    }
    const shakeAmt = this.shake * this.shake * 0.02;
    this.camera.rotation.set(pitch + (Math.random() - 0.5) * shakeAmt, yaw + (Math.random() - 0.5) * shakeAmt, 0, 'YXZ');
    const fov = this.settings.fov * this.zoom + this.fovBoost;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Crosshair ray: camera position + forward (exact screen centre). */
  ray(): { origin: Vector3; dir: Vector3 } {
    const dir = new Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    return { origin: this.camera.position.clone(), dir };
  }
}
