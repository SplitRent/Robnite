import { ArrowHelper, Box3, Box3Helper, BufferGeometry, Color, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type WebGLRenderer } from 'three';
import { h, setText } from '../ui/dom';
import type { Match } from '../game/Match';
import type { BuildTarget } from '../building/targeting';
import { pieceBounds } from '../building/grid';
import { TILE, TILE_H } from '../core/constants';
import type { CameraController } from '../camera/CameraController';

/**
 * Developer overlay (F1, dev builds or ?dev=1). Visualises the build
 * targeting pipeline: crosshair ray, hit point, normal, target cell and
 * preview bounds — critical for verifying 1:1 placement.
 */
export class DebugOverlay {
  readonly group = new Group();
  readonly el: HTMLElement;
  private text: HTMLElement;
  visible = false;
  private rayLine: LineSegments;
  private hitDot: Mesh;
  private normalArrow: ArrowHelper;
  private cellBox: Box3Helper;
  private boundsBox: Box3Helper;
  private colliderLines: LineSegments;
  private lastCollider = 0;

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'debug-overlay' }, h('div', { class: 'debug-title' }, 'DEBUG · F1 toggle · F2 mats · F3 weapons · F4 storm · F5 spawn bot · F6 kill bots · F7 reset builds'), (this.text = h('pre', { class: 'debug-text' })));
    parent.appendChild(this.el);
    const lineGeo = new BufferGeometry();
    lineGeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
    this.rayLine = new LineSegments(lineGeo, new LineBasicMaterial({ color: 0xffff00, depthTest: false }));
    this.hitDot = new Mesh(new SphereGeometry(0.08, 8, 6), new MeshBasicMaterial({ color: 0xff00ff, depthTest: false }));
    this.normalArrow = new ArrowHelper(new Vector3(0, 1, 0), new Vector3(), 1, 0x00ff88);
    this.cellBox = new Box3Helper(new Box3(), new Color(0xffaa00));
    this.boundsBox = new Box3Helper(new Box3(), new Color(0x00ffff));
    this.colliderLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.6 }));
    for (const o of [this.rayLine, this.hitDot, this.cellBox, this.boundsBox]) o.renderOrder = 99;
    this.group.add(this.rayLine, this.hitDot, this.normalArrow, this.cellBox, this.boundsBox, this.colliderLines);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
    this.group.visible = v;
  }

  update(match: Match, cam: CameraController, target: BuildTarget | null, renderer: WebGLRenderer, fps: number, time: number): void {
    if (!this.visible) return;
    const h = match.human;
    const info = renderer.info;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `FPS ${fps.toFixed(0)}  draw calls ${info.render.calls}  triangles ${info.render.triangles.toLocaleString()}  geometries ${info.memory.geometries}  textures ${info.memory.textures}${mem ? `  heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}`,
      `phase ${match.phase}  time ${match.time.toFixed(1)}  colliders ${match.world.collision.size}  builds ${match.builds.count}  items ${match.world.items.size}`,
      `player ${fmt(h.pos)}  vel ${fmt(h.vel)}  grounded ${h.grounded}  air ${h.air}`,
      `camera ${fmt(cam.camera.position)}  yaw ${cam.yaw.toFixed(3)}  pitch ${cam.pitch.toFixed(3)}`,
      `player cell X ${Math.floor(h.pos.x / TILE)} Y ${Math.floor((h.pos.y + 0.01) / TILE_H)} Z ${Math.floor(h.pos.z / TILE)}`,
    ];
    if (match.storm) lines.push(`storm phase ${match.storm.phase} ${match.storm.stage} t=${match.storm.timer.toFixed(1)} r=${match.storm.radius.toFixed(1)} dps=${match.storm.dps}`);
    if (target) {
      lines.push(
        '',
        'BUILD DEBUG',
        'Target:',
        `  X: ${target.grid.x}`,
        `  Y: ${target.grid.y}`,
        `  Z: ${target.grid.z}`,
        `Face: ${target.face}`,
        `Piece: ${target.piece.toUpperCase()}`,
        `Rotation: ${target.piece === 'wall' ? (target.rotation ? 'Z-plane (0°)' : 'X-plane (90°)') : `${target.rotation * 90}°`}`,
        `Valid: ${target.valid ? 'YES' : 'NO'}`,
        `Reason: ${target.reason || '—'}`,
        `Hit point: ${fmt(target.hitPoint)}  normal: ${fmt(target.normal)}`,
        `Key: ${target.key}`,
      );
    }
    lines.push('', 'BOTS');
    for (const b of match.brains.slice(0, 16)) lines.push(`  ${b.describe()}  hp ${Math.ceil(b.self.health)}/${Math.ceil(b.self.shield)}${b.self.alive ? '' : ' (out)'}`);
    setText(this.text, lines.join('\n'));

    // 3D helpers
    const ray = cam.ray();
    const end = target ? new Vector3(target.hitPoint.x, target.hitPoint.y, target.hitPoint.z) : ray.origin.clone().addScaledVector(ray.dir, 30);
    const pos = this.rayLine.geometry.getAttribute('position');
    pos.setXYZ(0, ray.origin.x + ray.dir.x * 0.5, ray.origin.y + ray.dir.y * 0.5 - 0.05, ray.origin.z + ray.dir.z * 0.5);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    this.hitDot.visible = !!target;
    this.normalArrow.visible = !!target;
    this.cellBox.visible = !!target;
    this.boundsBox.visible = !!target;
    if (target) {
      this.hitDot.position.copy(end);
      this.normalArrow.position.copy(end);
      this.normalArrow.setDirection(new Vector3(target.normal.x, target.normal.y, target.normal.z).normalize());
      const g = target.grid;
      this.cellBox.box.set(new Vector3(g.x * TILE, g.y * TILE_H, g.z * TILE), new Vector3((g.x + 1) * TILE, (g.y + 1) * TILE_H, (g.z + 1) * TILE));
      const b = pieceBounds(target.piece, target.grid, target.rotation);
      this.boundsBox.box.set(new Vector3(b.minX, b.minY, b.minZ), new Vector3(b.maxX, b.maxY, b.maxZ));
    }
    // Collision debug: colliders near the player (refreshed 4x per second).
    if (time - this.lastCollider > 0.25) {
      this.lastCollider = time;
      const list = match.world.collision.query({ minX: h.pos.x - 12, minY: h.pos.y - 6, minZ: h.pos.z - 12, maxX: h.pos.x + 12, maxY: h.pos.y + 10, maxZ: h.pos.z + 12 }).slice(0, 400);
      const P: number[] = [];
      for (const c of list) {
        const b = c.box;
        const xs = [b.minX, b.maxX];
        const ys = [b.minY, b.maxY];
        const zs = [b.minZ, b.maxZ];
        for (const y of ys) for (const z of zs) P.push(xs[0], y, z, xs[1], y, z);
        for (const x of xs) for (const z of zs) P.push(x, ys[0], z, x, ys[1], z);
        for (const x of xs) for (const y of ys) P.push(x, y, zs[0], x, y, zs[1]);
      }
      this.colliderLines.geometry.dispose();
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(P, 3));
      this.colliderLines.geometry = g;
    }
  }

  dispose(): void {
    this.el.remove();
    this.group.removeFromParent();
  }
}

function fmt(v: { x: number; y: number; z: number }): string {
  return `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
}
