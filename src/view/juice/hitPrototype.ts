// PROTOTYPE ("Juice: Hit taken"): red explosion at the impact point + camera shake, ?variant=A..C.
// The explosion lives in the main 3D scene beyond the Cockpit, so the Cockpit hides part of it and
// the ASCII pass turns it into red glyphs. The shake moves the whole camera (everything shakes).
import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';

export const HIT_VARIANTS = [
  { key: 'A', name: 'Red debris burst + random jitter shake' },
  { key: 'B', name: 'Red shockwave ring + roll-heavy shake' },
  { key: 'C', name: 'Red fireball + kick-back shake' },
];
export type HitKind = 'A' | 'B' | 'C';

/** Live-tunable from the sandbox panel. */
export const HIT_PROTO = {
  kind: 'A' as HitKind,
  /** Explosion life (s) and size (world units at the impact). */
  boomSeconds: 0.5,
  boomSize: 0.9,
  /** Shake length (s), strength (world units) and roll (radians). */
  shakeSeconds: 0.3,
  shake: 0.06,
  roll: 0.04,
};

type Piece = { mesh: THREE.Mesh; vel: THREE.Vector3 };
type Boom = { center: THREE.Vector3; age: number; pieces: Piece[]; ring?: THREE.Mesh; ball?: THREE.Mesh };

export class HitFx {
  private readonly booms: Boom[] = [];
  private readonly red = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.red });
  private readonly redFade = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.red, transparent: true });
  private readonly sphere = new THREE.SphereGeometry(1, 12, 8);
  private readonly torus = new THREE.TorusGeometry(1, 0.12, 6, 40);
  private readonly basePos: THREE.Vector3;
  private shakeAge = Infinity;
  private shakeSeed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.basePos = camera.position.clone();
  }

  /** A Word bullet reached the Cockpit at `center` (world): red explosion there. */
  explode(center: THREE.Vector3) {
    const kind = HIT_PROTO.kind;
    const size = HIT_PROTO.boomSize;
    const b: Boom = { center: center.clone(), age: 0, pieces: [] };
    const count = kind === 'A' ? 22 : kind === 'B' ? 10 : 8;
    for (let i = 0; i < count; i++) {
      const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.5).normalize();
      const speed = ((0.5 + Math.random()) * size * 1.6) / HIT_PROTO.boomSeconds;
      const mesh = new THREE.Mesh(this.sphere, this.red);
      mesh.position.copy(center);
      mesh.scale.setScalar(size * (kind === 'A' ? 0.06 : 0.045));
      this.scene.add(mesh);
      b.pieces.push({ mesh, vel: dir.multiplyScalar(speed) });
    }
    if (kind === 'B') {
      b.ring = new THREE.Mesh(this.torus, this.redFade.clone());
      b.ring.position.copy(center);
      this.scene.add(b.ring);
    }
    if (kind === 'C') {
      b.ball = new THREE.Mesh(this.sphere, this.redFade.clone());
      b.ball.position.copy(center);
      this.scene.add(b.ball);
    }
    this.booms.push(b);
  }

  /** A life was lost: shake the camera. */
  shake() {
    this.shakeAge = 0;
    this.shakeSeed = Math.random() * 100;
  }

  update(dt: number) {
    const life = HIT_PROTO.boomSeconds;
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.age += dt;
      const k = b.age / life;
      if (k >= 1) {
        this.drop(b);
        this.booms.splice(i, 1);
        continue;
      }
      for (const p of b.pieces) {
        p.mesh.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.max(0, 1 - (dt * 1.5) / life));
        p.mesh.scale.multiplyScalar(1 - dt * 1.2 / life);
      }
      if (b.ring) {
        b.ring.scale.setScalar(HIT_PROTO.boomSize * (0.2 + 1.6 * Math.sqrt(k)));
        (b.ring.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      }
      if (b.ball) {
        const grow = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
        b.ball.scale.setScalar(HIT_PROTO.boomSize * 0.6 * Math.max(0.01, grow));
      }
    }
    this.applyShake(dt);
  }

  /** Put the camera back at rest (call at the start of a frame, before placing Word bullets). */
  resetCamera() {
    this.camera.position.copy(this.basePos);
    this.camera.rotation.set(0, 0, 0);
  }

  private applyShake(dt: number) {
    if (this.shakeAge >= HIT_PROTO.shakeSeconds) return;
    this.shakeAge += dt;
    const k = Math.min(1, this.shakeAge / HIT_PROTO.shakeSeconds);
    const fall = (1 - k) * (1 - k); // decays fast
    const t = this.shakeAge * 40 + this.shakeSeed;
    const { shake, roll } = HIT_PROTO;
    if (HIT_PROTO.kind === 'A') {
      this.camera.position.x += Math.sin(t * 1.3) * shake * fall;
      this.camera.position.y += Math.sin(t * 1.7 + 1) * shake * fall;
      this.camera.rotation.z = Math.sin(t * 0.9) * roll * fall;
    } else if (HIT_PROTO.kind === 'B') {
      this.camera.position.x += Math.sin(t * 0.8) * shake * 0.5 * fall;
      this.camera.rotation.z = Math.sin(t * 0.6) * roll * 2.2 * fall;
    } else {
      // Kick: pushed back and down at once, then springs back with a small wobble.
      const kick = Math.exp(-k * 6) * (1 + 0.3 * Math.sin(k * 25));
      this.camera.position.z += shake * 3 * kick;
      this.camera.position.y -= shake * 1.5 * kick;
      this.camera.rotation.z = Math.sin(t * 0.7) * roll * fall;
    }
  }

  private drop(b: Boom) {
    for (const p of b.pieces) this.scene.remove(p.mesh);
    for (const m of [b.ring, b.ball]) {
      if (!m) continue;
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
  }

  dispose() {
    for (const b of this.booms) this.drop(b);
    this.camera.position.copy(this.basePos);
    this.camera.rotation.set(0, 0, 0);
    this.red.dispose();
    this.redFade.dispose();
    this.sphere.dispose();
    this.torus.dispose();
  }
}
