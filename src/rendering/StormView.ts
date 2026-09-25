import { CylinderGeometry, DoubleSide, Mesh, ShaderMaterial, Color, RingGeometry, MeshBasicMaterial, Group } from 'three';
import type { Storm } from '../storm/Storm';
import { stormTexture } from './textures';

/** The storm wall (animated translucent cylinder) and the next-circle ring. */
export class StormView {
  readonly group = new Group();
  private wall: Mesh;
  private ring: Mesh;
  private mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      uniforms: { map: { value: stormTexture() }, time: { value: 0 }, color: { value: new Color(0x8a4dff) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vY;
        void main() { vUv = uv; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float time; uniform vec3 color; varying vec2 vUv; varying float vY;
        void main() {
          vec4 a = texture2D(map, vec2(vUv.x * 24.0 + time * 0.03, vUv.y * 3.0 - time * 0.05));
          vec4 b = texture2D(map, vec2(vUv.x * 13.0 - time * 0.02, vUv.y * 2.0 + time * 0.04));
          float swirl = (a.r + b.b) * 0.5;
          float fade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
          gl_FragColor = vec4(mix(color, vec3(0.9, 0.7, 1.0), swirl * 0.4), (0.28 + swirl * 0.25) * fade);
        }`,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.wall = new Mesh(new CylinderGeometry(1, 1, 1, 96, 1, true), this.mat);
    this.wall.renderOrder = 3;
    this.wall.frustumCulled = false;
    this.ring = new Mesh(new RingGeometry(0.985, 1, 128), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 3;
    this.group.add(this.wall, this.ring);
  }

  update(storm: Storm | null, time: number, groundY: number): void {
    if (!storm) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const r = Math.max(0.5, storm.radius);
    this.wall.scale.set(r, 420, r);
    this.wall.position.set(storm.centerX, groundY + 150, storm.centerZ);
    this.mat.uniforms.time.value = time;
    this.ring.visible = storm.stage === 'wait' && storm.nextRadius > 0.5;
    this.ring.scale.set(storm.nextRadius, storm.nextRadius, 1);
    this.ring.position.set(storm.nextX, groundY + 0.4, storm.nextZ);
  }

  dispose(): void {
    this.wall.geometry.dispose();
    this.mat.dispose();
    this.ring.geometry.dispose();
    (this.ring.material as MeshBasicMaterial).dispose();
    this.group.removeFromParent();
  }
}
