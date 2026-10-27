import * as THREE from 'three';

/** Live-tunable from the sandbox panel. World units; camera at z = 7 looking at -z. */
export const ENEMY_LOOK = {
  /** Resting center of the Enemy ship (top center, far away). */
  position: { x: 0, y: 7.5, z: -27 },
  scale: 1.5,
  /** Idle motion: vertical bob and sideways sway (world units), banking (radians). */
  bob: 0.35,
  sway: 0.5,
  bank: 0.25,
};

const BOB_HZ = 0.5;
const SWAY_HZ = 0.23;
const BANK_HZ = 0.11;

/**
 * The Enemy ship ("Enemy ship and space backdrop": the dart). Built from primitives:
 * a six-sided cone hull pointing at the player, two swept wings, two rear engines,
 * flat-shaded so its facets read as distinct glyph bands. Idle: bob, sway, banking.
 */
export class EnemyShip {
  readonly root = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  private t = 0;

  constructor() {
    const mesh = (geo: THREE.BufferGeometry) => new THREE.Mesh(geo, this.material);

    const hull = mesh(new THREE.ConeGeometry(0.9, 4.5, 6));
    hull.rotation.x = Math.PI / 2; // nose toward the player (+z)

    const wingShape = new THREE.Shape([
      new THREE.Vector2(0, 1.2),
      new THREE.Vector2(4, -1.6),
      new THREE.Vector2(3.6, -2.2),
      new THREE.Vector2(0, -1.4),
    ]);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: false });
    for (const side of [1, -1]) {
      const wing = mesh(wingGeo);
      wing.rotation.x = -Math.PI / 2; // lie flat, swept back along -z
      wing.scale.x = side;
      wing.position.y = -0.1;
      this.model.add(wing);
    }

    for (const x of [-1.1, 1.1]) {
      const engine = mesh(new THREE.CylinderGeometry(0.4, 0.5, 2, 8));
      engine.rotation.x = Math.PI / 2;
      engine.position.set(x, 0.2, -1.6);
      this.model.add(engine);
    }

    this.model.add(hull);
    this.model.rotation.x = 0.45; // nose dipped so the player sees its back
    this.root.add(this.model);
  }

  update(dt: number) {
    this.t += dt;
    const { position, scale, bob, sway, bank } = ENEMY_LOOK;
    const wave = (hz: number) => Math.sin(this.t * hz * Math.PI * 2);
    this.root.position.set(position.x + wave(SWAY_HZ) * sway, position.y + wave(BOB_HZ) * bob, position.z);
    this.root.scale.setScalar(scale);
    this.model.rotation.z = wave(BANK_HZ) * bank;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    this.root.traverse((o) => o instanceof THREE.Mesh && geometries.add(o.geometry));
    geometries.forEach((g) => g.dispose());
    this.material.dispose();
  }
}
