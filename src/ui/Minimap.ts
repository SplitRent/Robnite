import { Color } from 'three';
import type { MapData } from '../map/mapTypes';
import type { Storm } from '../storm/Storm';
import type { BusState } from '../game/Match';

export interface MapMarker {
  x: number;
  z: number;
  yaw: number;
  self?: boolean;
}

/** Pre-rendered top-down map image + dynamic overlay (storm, player, POIs). */
export class MapRenderer {
  readonly image: HTMLCanvasElement;

  constructor(readonly map: MapData) {
    const size = 256;
    this.image = document.createElement('canvas');
    this.image.width = this.image.height = size;
    const ctx = this.image.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const hf = map.terrain;
    const c = new Color();
    const grass = new Color(map.palette.grass);
    const rock = new Color(map.palette.rock);
    const sand = new Color(map.palette.sand);
    const water = new Color(0x2f86b8);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = -map.half + ((px + 0.5) / size) * map.half * 2;
        const z = -map.half + ((py + 0.5) / size) * map.half * 2;
        const hgt = hf.heightAt(x, z);
        c.copy(grass);
        const n = hf.normalAt(x, z);
        if (n.y < 0.8) c.lerp(rock, Math.min(1, (0.8 - n.y) * 3));
        const inLake = map.water && Math.hypot(x - map.water.x, z - map.water.z) < map.water.radius;
        if (inLake && map.waterLevel !== null && hgt < map.waterLevel + 0.5) c.copy(hgt < map.waterLevel ? water : sand);
        const shade = 0.75 + Math.max(-0.2, Math.min(0.3, (n.x - n.z) * 0.9)) + (hgt / 60) * 0.3;
        const i = (py * size + px) * 4;
        img.data[i] = Math.min(255, c.r * 255 * shade);
        img.data[i + 1] = Math.min(255, c.g * 255 * shade);
        img.data[i + 2] = Math.min(255, c.b * 255 * shade);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (v: number) => ((v + map.half) / (map.half * 2)) * size;
    // Roads
    ctx.strokeStyle = 'rgba(60,60,64,0.85)';
    ctx.lineWidth = 2;
    for (const r of map.regions) {
      if (!r.points) continue;
      ctx.beginPath();
      r.points.forEach(([x, z], i) => (i ? ctx.lineTo(toPx(x), toPx(z)) : ctx.moveTo(toPx(x), toPx(z))));
      ctx.stroke();
    }
    // Training stations / pads
    if (map.id === 'training_grounds') {
      ctx.fillStyle = 'rgba(42,53,66,0.9)';
      for (const p of map.pois) {
        const s = (14 / (map.half * 2)) * size;
        ctx.fillRect(toPx(p.x) - s / 2, toPx(p.z) - s / 2, s, s);
      }
    }
    // Buildings
    ctx.fillStyle = 'rgba(230,225,215,0.9)';
    for (const b of map.boxes) {
      if (!b.collide || b.max[1] - b.min[1] < 2) continue;
      const w = ((b.max[0] - b.min[0]) / (map.half * 2)) * size;
      const hh = ((b.max[2] - b.min[2]) / (map.half * 2)) * size;
      ctx.fillRect(toPx(b.min[0]), toPx(b.min[2]), Math.max(1, w), Math.max(1, hh));
    }
  }

  /** Draw the map into `ctx` centred on (cx, cz) showing `radius` metres. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cz: number, radius: number, storm: Storm | null, markers: MapMarker[], opts: { labels: boolean; bus?: BusState | null; circle?: boolean }): void {
    const map = this.map;
    const scale = Math.min(w, h) / (radius * 2);
    const sx = (x: number) => w / 2 + (x - cx) * scale;
    const sz = (z: number) => h / 2 + (z - cz) * scale;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (opts.circle) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.fillStyle = '#0d1520';
    ctx.fillRect(0, 0, w, h);
    const full = map.half * 2 * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.image, sx(-map.half), sz(-map.half), full, full);
    if (storm) {
      // Storm tint outside the circle
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.arc(sx(storm.centerX), sz(storm.centerZ), storm.radius * scale, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(120,60,255,0.38)';
      ctx.fill('evenodd');
      ctx.restore();
      ctx.strokeStyle = 'rgba(190,150,255,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(storm.centerX), sz(storm.centerZ), storm.radius * scale, 0, Math.PI * 2);
      ctx.stroke();
      if (storm.stage === 'wait' && storm.nextRadius > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(sx(storm.nextX), sz(storm.nextZ), storm.nextRadius * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (opts.bus) {
      ctx.strokeStyle = 'rgba(255,210,80,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(sx(opts.bus.start.x), sz(opts.bus.start.z));
      ctx.lineTo(sx(opts.bus.end.x), sz(opts.bus.end.z));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd24f';
      ctx.beginPath();
      ctx.arc(sx(opts.bus.pos.x), sz(opts.bus.pos.z), 5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (opts.labels) {
      ctx.font = `700 ${Math.max(9, Math.min(15, w / 50))}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      for (const p of map.pois) {
        if (p.lootValue === 0 && map.id !== 'training_grounds') continue;
        const x = sx(p.x);
        const y = sz(p.z);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(p.name.toUpperCase(), x + 1, y + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.name.toUpperCase(), x, y);
      }
    }
    for (const m of markers) {
      const x = sx(m.x);
      const y = sz(m.z);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-m.yaw);
      ctx.fillStyle = m.self ? '#5ee7ff' : '#ff5a5a';
      ctx.strokeStyle = '#0b1220';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 6);
      ctx.lineTo(0, 3);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
}
