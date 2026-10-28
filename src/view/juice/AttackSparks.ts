import * as THREE from 'three';
import { ASCII_STYLE } from '../../render/asciiStyle';

/** Live-tunable from the sandbox panel. */
export const ATTACK_SPARKS_LOOK = {
  count: 16,
  /** Life (s) and how far they fly (fraction of the way to the Enemy ship). */
  seconds: 0.45,
  reach: 0.3,
  /** Radius per unit of distance from the camera (≈ 2 grid cells: "big"). */
  size: 0.022,
};

/** Where the sparks start: the Cockpit's center, just behind the yoke (camera-local), so it hides them. */
const ORIGIN_LOCAL = new THREE.Vector3(0, -0.45, -1.9);
/** Half-angle of the fan around the aim, radians. */
const FAN = 0.6;

type Spark = { mesh: THREE.Mesh; vel: THREE.Vector3; age: number };

/**
 * Attack word fired ("Juice: build the effects"): big yellow sparks burst from behind the Cockpit's
 * center toward the Enemy ship. They are 3D particles in the main scene, so the Cockpit hides them
 * where it's in front, and the ASCII pass turns them into yellow glyphs.
 */
export class AttackSparks {
  private sparks: Spark[] = [];
  private readonly geo = new THREE.SphereGeometry(1, 8, 6);
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
      const speed = ((reach * dist) / seconds) * (0.5 + Math.random() * 0.8);
      const mesh = new THREE.Mesh(this.geo, this.mat);
      mesh.position.copy(from);
      this.scene.add(mesh);
      this.sparks.push({ mesh, vel: dir.multiplyScalar(speed), age: 0 });
    }
  }

  update(dt: number) {
    const { seconds, size } = ATTACK_SPARKS_LOOK;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      const k = s.age / seconds;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
        continue;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      // Size scales with distance so a spark keeps its on-screen size as it flies; shrinks as it fades.
      s.mesh.scale.setScalar(size * (this.camera.position.z - s.mesh.position.z) * (1 - k * 0.6));
    }
  }

  dispose() {
    for (const s of this.sparks) this.scene.remove(s.mesh);
    this.sparks = [];
    this.geo.dispose();
    this.mat.dispose();
  }
}
