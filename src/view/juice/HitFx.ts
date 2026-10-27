import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';

/** Live-tunable from the sandbox panel. */
export const HIT_LOOK = {
  /** Red debris life (s) and spread (world units at the impact). */
  boomSeconds: 0.5,
  boomSize: 0.9,
  /** Camera shake length (s), strength (world units) and roll (radians). */
  shakeSeconds: 0.3,
  shake: 0.06,
  roll: 0.04,
};

const DEBRIS_COUNT = 22;
/** Debris piece radius, as a fraction of boomSize. */
const PIECE_RADIUS = 0.06;

type Piece = { mesh: THREE.Mesh; vel: THREE.Vector3 };
type Boom = { age: number; pieces: Piece[] };

/**
 * Hit taken ("Juice: Hit taken"):
 * - the arriving Word bullet vanishes and **red debris** bursts at the impact point. The debris
 *   lives in the main 3D scene beyond the Cockpit, so the Cockpit hides part of it and the ASCII
 *   pass turns it into red glyphs;
 * - on a life lost, the **camera jitters** with a small roll, decaying fast (everything shakes,
 *   Word bullets included: they're placed with the camera at rest, see resetCamera()).
 * The lost lamp's flicker lives in Cockpit.
 */
export class HitFx {
  private readonly booms: Boom[] = [];
  private readonly red = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.red });
  private readonly sphere = new THREE.SphereGeometry(1, 12, 8);
  private readonly basePos: THREE.Vector3;
  private shakeAge = Infinity;
  private shakeSeed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.basePos = camera.position.clone();
  }

  /** A Word bullet reached the Cockpit at `center` (world): red debris burst there. */
  explode(center: THREE.Vector3) {
    const { boomSize, boomSeconds } = HIT_LOOK;
    const b: Boom = { age: 0, pieces: [] };
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.5).normalize();
      const speed = ((0.5 + Math.random()) * boomSize * 1.6) / boomSeconds;
      const mesh = new THREE.Mesh(this.sphere, this.red);
      mesh.position.copy(center);
      mesh.scale.setScalar(boomSize * PIECE_RADIUS);
      this.scene.add(mesh);
      b.pieces.push({ mesh, vel: dir.multiplyScalar(speed) });
    }
    this.booms.push(b);
  }

  /** A life was lost: shake the camera. */
  shake() {
    this.shakeAge = 0;
    this.shakeSeed = Math.random() * 100;
  }

  /** Put the camera back at rest (call at the start of a frame, before placing Word bullets). */
  resetCamera() {
    this.camera.position.copy(this.basePos);
    this.camera.rotation.set(0, 0, 0);
  }

  /** Advance debris and apply this frame's shake (after Word bullets are placed). */
  update(dt: number) {
    const life = HIT_LOOK.boomSeconds;
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.age += dt;
      if (b.age >= life) {
        for (const p of b.pieces) this.scene.remove(p.mesh);
        this.booms.splice(i, 1);
        continue;
      }
      for (const p of b.pieces) {
        p.mesh.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.max(0, 1 - (dt * 1.5) / life)); // drag scaled to the life
        p.mesh.scale.multiplyScalar(1 - (dt * 1.2) / life); // shrink as it fades out
      }
    }

    if (this.shakeAge >= HIT_LOOK.shakeSeconds) return;
    this.shakeAge += dt;
    const k = Math.min(1, this.shakeAge / HIT_LOOK.shakeSeconds);
    const fall = (1 - k) * (1 - k); // decays fast
    const t = this.shakeAge * 40 + this.shakeSeed;
    const { shake, roll } = HIT_LOOK;
    this.camera.position.x += Math.sin(t * 1.3) * shake * fall;
    this.camera.position.y += Math.sin(t * 1.7 + 1) * shake * fall;
    this.camera.rotation.z = Math.sin(t * 0.9) * roll * fall;
  }

  dispose() {
    for (const b of this.booms) for (const p of b.pieces) this.scene.remove(p.mesh);
    this.booms.length = 0;
    this.resetCamera();
    this.red.dispose();
    this.sphere.dispose();
  }
}
