import * as THREE from 'three';

/**
 * Live-tunable from the sandbox panel.
 * TODO (later effort, player settings): let players turn moving stars off, since the motion can
 * cause dizziness. `speed = 0` already freezes them; the setting should also override any juice
 * effect that drives the speed.
 */
export const STAR_DRIFT = {
  /** World units / s toward the camera. The juice tickets may drive this from game signals. */
  speed: 6,
  /** The future player setting: false = stars stay still (dizziness), whatever drives the speed. */
  motion: true,
};

const COUNT = 450;
/** Box the stars live in (world units); they wrap from far to near. */
const BOX = { x: 40, y: 22, near: 6, far: -80 };
/** Fade-in distance from the far end, so stars don't pop in. */
const FADE = 20;
/** Point size in world units (shrinks with distance, so near stars become bigger glyphs). */
const SIZE = 0.6;

/**
 * Space backdrop ("Enemy ship and space backdrop": stars flying past). Points that drift toward
 * the camera and wrap around; through the ASCII pass they read as `. , - ~` growing as they near.
 */
export class StarDrift {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly col = new Float32Array(COUNT * 3);
  private readonly brightness = new Float32Array(COUNT);

  constructor() {
    for (let i = 0; i < COUNT; i++) {
      this.respawn(i, BOX.far + Math.random() * (BOX.near - BOX.far));
      this.brightness[i] = 0.35 + Math.random() * 0.65;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: SIZE, sizeAttenuation: true, vertexColors: true }));
  }

  private respawn(i: number, z: number) {
    this.pos[i * 3] = (Math.random() * 2 - 1) * BOX.x;
    this.pos[i * 3 + 1] = (Math.random() * 2 - 1) * BOX.y;
    this.pos[i * 3 + 2] = z;
  }

  update(dt: number) {
    for (let i = 0; i < COUNT; i++) {
      const speed = STAR_DRIFT.motion ? STAR_DRIFT.speed : 0;
      const z = this.pos[i * 3 + 2] + dt * speed;
      // Wrap both ways: forward (toward the camera) and backward (negative speed).
      if (z > BOX.near) this.respawn(i, BOX.far);
      else if (z < BOX.far) this.respawn(i, BOX.near);
      else this.pos[i * 3 + 2] = z;
      const v = this.brightness[i] * Math.min(1, (this.pos[i * 3 + 2] - BOX.far) / FADE, (BOX.near - this.pos[i * 3 + 2]) / 2);
      this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = v;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
