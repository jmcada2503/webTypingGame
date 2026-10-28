import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';

/** Live-tunable from the sandbox panel. */
export const ATTACK_SPARKS_LOOK = {
  count: 16,
  /** Life (s) and how far they fly (fraction of the way to the Enemy ship). */
  seconds: 0.35,
  reach: 0.15,
  /** Streak thickness and length, per unit of distance from the camera (thin + short = spark). */
  thickness: 0.0065,
  length: 0.055,
  /** Downward pull (world units / s²) so sparks arc a little as they fly. */
  gravity: 6,
};

/** Where the sparks start: the Cockpit's center, just behind the yoke (camera-local), so it hides them. */
const ORIGIN_LOCAL = new THREE.Vector3(0, -0.45, -1.9);
/** Half-angle of the fan around the aim, radians. */
const FAN = 0.45;
const UP = new THREE.Vector3(0, 1, 0);

type Spark = { mesh: THREE.Mesh; vel: THREE.Vector3; age: number };

/**
 * Attack word fired ("Juice: build the effects"): yellow sparks burst from behind the Cockpit's
 * center toward the Enemy ship. Each spark is a thin, short streak in the main 3D scene, pointing
 * where it flies (the ASCII pass turns it into a small dash of yellow glyphs); the Cockpit hides
 * them where it's in front.
 */
export class AttackSparks {
  private sparks: Spark[] = [];
  /** Unit cylinder along +y; scaled to a thin streak and turned along the velocity. */
  private readonly geo = new THREE.CylinderGeometry(1, 1, 1, 5);
  private readonly mat = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.yellow });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** Fire toward `target` (world, usually the Enemy ship). */
  fire(target: THREE.Vector3) {
    const { count, seconds, reach } = ATTACK_SPARKS_LOOK;
    const from = ORIGIN_LOCAL.clone().add(this.camera.position);
    const aim = target.clone().sub(from);
    const dist = aim.length();
    aim.normalize();
    for (let i = 0; i < count; i++) {
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(aim).normalize();
      const dir = aim.clone().applyAxisAngle(axis, (Math.random() * 2 - 1) * FAN);
      const speed = ((reach * dist) / seconds) * (0.6 + Math.random() * 0.8);
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.sparks.push({ mesh, vel: dir.multiplyScalar(speed), age: Math.random() * 0.05 });
    }
  }

  update(dt: number) {
    const { seconds, thickness, length, gravity } = ATTACK_SPARKS_LOOK;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      const k = s.age / seconds;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= gravity * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      // A thin streak along the velocity; sized by distance so it looks the same near or far.
      const d = this.camera.position.z - s.mesh.position.z;
      s.mesh.quaternion.setFromUnitVectors(UP, s.vel.clone().normalize());
      s.mesh.scale.set(thickness * d, length * d * (1 - k * 0.5), thickness * d);
    }
  }

  dispose() {
    for (const s of this.sparks) this.scene.remove(s.mesh);
    this.sparks = [];
    this.geo.dispose();
    this.mat.dispose();
  }
}
