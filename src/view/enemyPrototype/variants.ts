// PROTOTYPE ("Enemy ship and space backdrop"): ships built from primitives + backdrops, mixable.
// ?variant=A..D picks a preset; the sandbox panel can swap ship / backdrop live. Throwaway.
import * as THREE from 'three';

/** Live-tunable from the sandbox panel. */
export const ENEMY_PROTO = {
  ship: 'saucer' as ShipKind,
  backdrop: 'stars' as BackdropKind,
  /** Enemy ship center, world units (camera at z = 7). */
  position: { x: 0, y: 7.5, z: -27 },
  scale: 1,
  /** Idle motion. */
  bob: 0.35,
  sway: 0.5,
  spin: 1,
  /** Camera vertical field of view (degrees). */
  fov: 40,
  /** Stars flying toward the camera (drift backdrop), world units / s. */
  starSpeed: 6,
};

export type ShipKind = 'saucer' | 'dart' | 'station' | 'crystal';
export type BackdropKind = 'none' | 'stars' | 'drift' | 'planet';
export const SHIPS: ShipKind[] = ['saucer', 'dart', 'station', 'crystal'];
export const BACKDROPS: BackdropKind[] = ['none', 'stars', 'drift', 'planet'];

export const ENEMY_VARIANTS = [
  { key: 'A', name: 'Saucer + twinkling stars', ship: 'saucer', backdrop: 'stars' },
  { key: 'B', name: 'Delta fighter + stars flying past', ship: 'dart', backdrop: 'drift' },
  { key: 'C', name: 'Ring station + planet', ship: 'station', backdrop: 'planet' },
  { key: 'D', name: 'Crystal eye + empty space', ship: 'crystal', backdrop: 'none' },
] as const;

const lit = (flat = false) => new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: flat });

// ---------------------------------------------------------------- ships

/** `size` evens out on-screen size between designs (multiplied by the panel's scale). */
type Ship = { root: THREE.Object3D; size: number; animate(t: number, dt: number): void };

function saucer(): Ship {
  const root = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(3, 48, 24), lit());
  hull.scale.set(1, 0.28, 1);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), lit());
  dome.position.y = 0.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.15, 0.18, 12, 64), lit());
  ring.rotation.x = Math.PI / 2;
  const pods = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), lit());
    const a = (i / 3) * Math.PI * 2;
    pod.position.set(Math.cos(a) * 1.7, -0.75, Math.sin(a) * 1.7);
    pods.add(pod);
  }
  root.add(hull, dome, ring, pods);
  root.rotation.x = 0.35; // tilt toward the player so the top reads
  return {
    root,
    size: 1.35,
    animate: (_t, dt) => {
      pods.rotation.y += dt * 0.8 * ENEMY_PROTO.spin;
      ring.rotation.z += dt * 0.3 * ENEMY_PROTO.spin;
    },
  };
}

function dart(): Ship {
  const root = new THREE.Group();
  // Nose points at the player (+z).
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 4.5, 6), lit(true));
  body.rotation.x = Math.PI / 2;
  const wingShape = new THREE.Shape([new THREE.Vector2(0, 1.2), new THREE.Vector2(4, -1.6), new THREE.Vector2(3.6, -2.2), new THREE.Vector2(0, -1.4)]);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: false });
  const wings = new THREE.Group();
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(wingGeo, lit(true));
    w.rotation.x = -Math.PI / 2; // lie flat, sweep back along -z
    w.scale.x = side;
    w.position.y = -0.1;
    wings.add(w);
  }
  const engines = new THREE.Group();
  for (const x of [-1.1, 1.1]) {
    const e = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 2, 8), lit(true));
    e.rotation.x = Math.PI / 2;
    e.position.set(x, 0.2, -1.6);
    engines.add(e);
  }
  root.add(body, wings, engines);
  root.rotation.x = 0.45;
  return {
    root,
    size: 1.5,
    animate: (t) => {
      root.rotation.z = Math.sin(t * 0.7) * 0.25 * ENEMY_PROTO.spin; // banking
    },
  };
}

function station(): Ship {
  const root = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.55, 16, 48), lit());
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 16), lit());
  const spokes = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.8, 8), lit());
    s.rotation.z = (i / 4) * Math.PI;
    spokes.add(s);
  }
  const spikes = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 8), lit(true));
    const a = (i / 6) * Math.PI * 2;
    c.position.set(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0);
    c.rotation.z = a - Math.PI / 2;
    spikes.add(c);
  }
  const wheel = new THREE.Group();
  wheel.add(ring, spokes, spikes);
  root.add(wheel, core);
  root.rotation.x = -0.25;
  return {
    root,
    size: 0.9,
    animate: (_t, dt) => {
      wheel.rotation.z += dt * 0.35 * ENEMY_PROTO.spin;
    },
  };
}

function crystal(): Ship {
  const root = new THREE.Group();
  const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 0), lit(true));
  const shards = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), lit(true));
    const a = (i / 6) * Math.PI * 2;
    o.position.set(Math.cos(a) * 3.6, Math.sin(a * 2) * 0.6, Math.sin(a) * 3.6);
    o.scale.y = 1.8;
    shards.add(o);
  }
  root.add(eye, shards);
  return {
    root,
    size: 1.3,
    animate: (_t, dt) => {
      eye.rotation.y += dt * 0.4 * ENEMY_PROTO.spin;
      eye.rotation.x += dt * 0.15 * ENEMY_PROTO.spin;
      shards.rotation.y -= dt * 0.7 * ENEMY_PROTO.spin;
      shards.children.forEach((s) => (s.rotation.y += dt * 2));
    },
  };
}

const SHIP_BUILDERS: Record<ShipKind, () => Ship> = { saucer, dart, station, crystal };

// ---------------------------------------------------------------- backdrops

type Backdrop = { root: THREE.Object3D; animate(t: number, dt: number): void };

/** Stars as screen-space points: small (≈ half a cell) so each becomes one faint glyph. */
function starField(count: number, sizePx: number, spread: { x: number; y: number; zNear: number; zFar: number }) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const base = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * spread.x;
    pos[i * 3 + 1] = (Math.random() * 2 - 1) * spread.y;
    pos[i * 3 + 2] = spread.zFar + Math.random() * (spread.zNear - spread.zFar);
    base[i] = 0.35 + Math.random() * 0.65;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: sizePx, sizeAttenuation: false, vertexColors: true }));
  return { points, pos, col, base, geo };
}

function stars(): Backdrop {
  const f = starField(450, 8, { x: 60, y: 34, zNear: -45, zFar: -80 });
  const phase = Float32Array.from({ length: f.base.length }, () => Math.random() * Math.PI * 2);
  return {
    root: f.points,
    animate: (t) => {
      for (let i = 0; i < f.base.length; i++) {
        const v = f.base[i] * (0.6 + 0.4 * Math.sin(t * 1.7 + phase[i]));
        f.col[i * 3] = f.col[i * 3 + 1] = f.col[i * 3 + 2] = v;
      }
      f.geo.attributes.color.needsUpdate = true;
    },
  };
}

function drift(): Backdrop {
  const spread = { x: 40, y: 22, zNear: 6, zFar: -80 };
  const f = starField(450, 4, spread);
  (f.points.material as THREE.PointsMaterial).sizeAttenuation = true;
  (f.points.material as THREE.PointsMaterial).size = 0.6;
  return {
    root: f.points,
    animate: (_t, dt) => {
      for (let i = 0; i < f.base.length; i++) {
        let z = f.pos[i * 3 + 2] + dt * ENEMY_PROTO.starSpeed;
        if (z > spread.zNear) {
          z = spread.zFar;
          f.pos[i * 3] = (Math.random() * 2 - 1) * spread.x;
          f.pos[i * 3 + 1] = (Math.random() * 2 - 1) * spread.y;
        }
        f.pos[i * 3 + 2] = z;
        // Fade in from the far end so stars don't pop.
        const v = f.base[i] * Math.min(1, (z - spread.zFar) / 20);
        f.col[i * 3] = f.col[i * 3 + 1] = f.col[i * 3 + 2] = v;
      }
      f.geo.attributes.position.needsUpdate = true;
      f.geo.attributes.color.needsUpdate = true;
    },
  };
}

function planet(): Backdrop {
  const root = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(22, 64, 32), new THREE.MeshLambertMaterial({ color: 0x9a9a9a }));
  globe.position.set(-38, -18, -75);
  const ringGeo = new THREE.RingGeometry(27, 33, 96);
  const rings = new THREE.Mesh(ringGeo, new THREE.MeshLambertMaterial({ color: 0x6a6a6a, side: THREE.DoubleSide }));
  rings.position.copy(globe.position);
  rings.rotation.set(-1.25, 0.3, 0.2);
  const s = stars();
  root.add(globe, rings, s.root);
  return {
    root,
    animate: (t, dt) => {
      globe.rotation.y += dt * 0.02;
      s.animate(t, dt);
    },
  };
}

const BACKDROP_BUILDERS: Record<BackdropKind, () => Backdrop> = {
  none: () => ({ root: new THREE.Group(), animate: () => {} }),
  stars,
  drift,
  planet,
};

// ---------------------------------------------------------------- scene part

/** Enemy ship + backdrop living in the GameView's scene; rebuilds when the panel swaps kinds. */
export class EnemyAndBackdrop {
  private t = 0;
  private ship: Ship | null = null;
  private shipKind: ShipKind | null = null;
  private backdrop: Backdrop | null = null;
  private backdropKind: BackdropKind | null = null;
  private readonly holder = new THREE.Group();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    scene.add(this.holder);
  }

  update(dt: number) {
    this.t += dt;
    const p = ENEMY_PROTO;
    if (p.ship !== this.shipKind) {
      if (this.ship) this.holder.remove(this.ship.root);
      this.ship = SHIP_BUILDERS[p.ship]();
      this.shipKind = p.ship;
      this.holder.add(this.ship.root);
    }
    if (p.backdrop !== this.backdropKind) {
      if (this.backdrop) this.scene.remove(this.backdrop.root);
      this.backdrop = BACKDROP_BUILDERS[p.backdrop]();
      this.backdropKind = p.backdrop;
      this.scene.add(this.backdrop.root);
    }
    this.holder.position.set(
      p.position.x + Math.sin(this.t * 0.23 * Math.PI * 2) * p.sway,
      p.position.y + Math.sin(this.t * 0.5 * Math.PI * 2) * p.bob,
      p.position.z,
    );
    this.holder.scale.setScalar(p.scale * this.ship!.size);
    this.ship!.animate(this.t, dt);
    this.backdrop!.animate(this.t, dt);
    if (this.camera.fov !== p.fov) {
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Where Word bullets leave from: the ship's center right now. */
  get muzzle() {
    return this.holder.position;
  }
}
