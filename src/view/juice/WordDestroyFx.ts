import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { paintGlyph, type WordSnapshot } from '../words/WordBulletSprites';

/** Live-tunable from the sandbox panel. */
export const DESTROY_LOOK = {
  /** Shard speed, in word-heights per second (scaled by depth so it feels the same near or far). */
  shardSpeed: 9,
  /** Shard spin, radians / s. */
  shardSpin: 8,
  /** Green ring life, seconds. */
  burstSeconds: 0.5,
  /** Green ring size, in word-heights. */
  burstSize: 2.4,
  /** Cockpit sparks: life (s) and how far they fly (fraction of the way to the word). */
  sparkSeconds: 0.3,
  sparkReach: 0.35,
  /** Cockpit spark radius per unit of distance from the camera (kept small: a subtle cue). */
  sparkSize: 0.016,
};

/**
 * Where the Cockpit "fires" from, alternating left / right: behind the outer end of each side
 * console (camera-local, see Cockpit.ts), so the console hides the start.
 */
const MUZZLES_LOCAL = [new THREE.Vector3(-1.0, -0.4, -1.9), new THREE.Vector3(1.0, -0.4, -1.9)];
const SPARK_COUNT = 8;
/** Half-angle of the spark fan around the direction to the destroyed word, radians. */
const SPARK_FAN = 0.9;

const ADVANCE = 0.6; // IBM Plex Mono advance / em
const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
const tmp = new THREE.Vector3();

type Shard = { sprite: THREE.Sprite; vel: THREE.Vector3; spin: number; age: number };
type Burst = { center: THREE.Vector3; em: number; age: number; seed: number };
type Spark = { mesh: THREE.Mesh; vel: THREE.Vector3; age: number };

/** Glyph textures cached per char (shards are the word's own letters, outlined). */
const glyphCache = new Map<string, { map: THREE.CanvasTexture; aspect: number; heightEm: number }>();
function glyphTexture(ch: string) {
  let g = glyphCache.get(ch);
  if (!g) {
    const canvas = document.createElement('canvas');
    const aspect = paintGlyph(canvas, ch, ASCII_STYLE.palette.fg);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    g = { map, aspect, heightEm: canvas.height / 96 };
    glyphCache.set(ch, g);
  }
  return g;
}

/**
 * Word bullet destroyed ("Juice: Word bullet destroyed"): the word breaks. Each letter becomes an
 * outlined shard flung off screen fast in its own direction (spinning, accelerating, no fade),
 * and a green ring of grid glyphs bursts where the word was. The ring is grid text, so it always
 * sits behind every Word bullet: the next word stays readable. Small green sparks also burst from
 * behind the left / right console (alternating), toward the word, as if the ship fired at it.
 */
export class WordDestroyFx {
  private readonly shards: Shard[] = [];
  private readonly bursts: Burst[] = [];
  private readonly sparks: Spark[] = [];
  /** Next muzzle to fire from (0 = left, 1 = right). */
  private nextMuzzle = 0;
  private readonly sparkGeo = new THREE.SphereGeometry(1, 8, 6);
  private readonly sparkMat = new THREE.MeshBasicMaterial({ color: ASCII_STYLE.palette.green });

  constructor(
    /** Overlay scene (Word bullets live there; shards fly over the ASCII frame like them). */
    private readonly overlay: THREE.Scene,
    /** Main 3D scene (through the ASCII pass; the Cockpit lives there too). */
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  burst(w: WordSnapshot) {
    const n = w.letters.length;
    const d = this.camera.position.z - w.center.z;
    w.letters.forEach((ch, i) => {
      const { map, aspect, heightEm } = glyphTexture(ch);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
      const h = w.em * heightEm;
      sprite.scale.set(h * aspect, h, 1);
      sprite.position.copy(w.center).add(tmp.set((i - (n - 1) / 2) * ADVANCE * w.em, 0, 0));
      // Outward from the word's center plus randomness, so letters scatter in different directions.
      const out = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const a = Math.atan2(Math.random() * 2 - 1 + 0.25, out + (Math.random() * 2 - 1) * 0.8);
      const speed = DESTROY_LOOK.shardSpeed * w.em * (0.7 + Math.random() * 0.6) * (d / 5);
      this.overlay.add(sprite);
      this.shards.push({
        sprite,
        vel: new THREE.Vector3(Math.cos(a) * speed, Math.sin(a) * speed, speed * 0.4),
        spin: (Math.random() * 2 - 1) * DESTROY_LOOK.shardSpin,
        age: 0,
      });
    });
    this.bursts.push({ center: w.center.clone(), em: w.em, age: 0, seed: Math.random() * 1000 });
    this.fireSparks(w.center);
  }

  /**
   * Green sparks from behind the left or right console (alternating), fanned toward the destroyed
   * word, as if the player's ship fired at it from that side. They are small bright 3D particles in the main scene: the Cockpit
   * geometry hides them where it is in front, and the ASCII pass turns them into green glyphs.
   */
  private fireSparks(target: THREE.Vector3) {
    const from = tmp.copy(MUZZLES_LOCAL[this.nextMuzzle]).add(this.camera.position);
    this.nextMuzzle = 1 - this.nextMuzzle;
    const toWord = target.clone().sub(from);
    const dist = toWord.length();
    toWord.normalize();
    for (let i = 0; i < SPARK_COUNT; i++) {
      // Fan around the aim: tilt by a random angle around a random axis perpendicular to it.
      const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(toWord).normalize();
      const dir = toWord.clone().applyAxisAngle(axis, (Math.random() * 2 - 1) * SPARK_FAN);
      const speed = ((DESTROY_LOOK.sparkReach * dist) / DESTROY_LOOK.sparkSeconds) * (0.5 + Math.random() * 0.8);
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      mesh.position.copy(from);
      mesh.scale.setScalar(DESTROY_LOOK.sparkSize * (this.camera.position.z - from.z));
      this.scene.add(mesh);
      this.sparks.push({ mesh, vel: dir.multiplyScalar(speed), age: 0 });
    }
  }

  /** Call every frame before the Cockpit writes its text (Cockpit text wins over the ring). */
  update(dt: number, text: TextGrid) {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.age += dt;
      s.vel.multiplyScalar(1 + dt * 1.5); // accelerate: snappy exit
      s.sprite.position.addScaledVector(s.vel, dt);
      s.sprite.material.rotation += s.spin * dt;
      if (s.age > 1.2 || !this.onScreen(s.sprite.position)) {
        this.overlay.remove(s.sprite);
        s.sprite.material.dispose();
        this.shards.splice(i, 1);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.age += dt;
      const k = s.age / DESTROY_LOOK.sparkSeconds;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
        continue;
      }
      s.mesh.position.addScaledVector(s.vel, dt);
      // Size scales with distance so a spark stays about the same on screen as it flies.
      s.mesh.scale.setScalar(DESTROY_LOOK.sparkSize * (this.camera.position.z - s.mesh.position.z) * (1 - k * 0.6));
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const k = b.age / DESTROY_LOOK.burstSeconds;
      if (k >= 1) this.bursts.splice(i, 1);
      else this.drawRing(text, b, k);
    }
  }

  /** Expanding circle of green glyphs, @ → * → + → . , breaking up as it fades. */
  private drawRing(text: TextGrid, b: Burst, k: number) {
    const g = this.toGrid(b.center);
    const rows = this.rowsPerUnit(b.center) * b.em * DESTROY_LOOK.burstSize;
    const r = 0.6 + rows * Math.sqrt(k);
    const ch = k < 0.25 ? '@' : k < 0.5 ? '*' : k < 0.75 ? '+' : '.';
    const step = Math.max(6, 40 / r);
    for (let deg = 0; deg < 360; deg += step) {
      if (k > 0.5 && Math.sin(deg * 7 + b.seed) > 0.3) continue;
      const a = (deg * Math.PI) / 180;
      text.write(Math.floor(g.col + Math.cos(a) * r * CELL_ASPECT), Math.floor(g.row - Math.sin(a) * r), ch, 'green');
    }
    if (k < 0.2) text.write(Math.floor(g.col), Math.floor(g.row), '@', 'green');
  }

  private toGrid(world: THREE.Vector3) {
    const { cols, rows } = ASCII_STYLE.grid;
    tmp.copy(world).project(this.camera);
    return { col: ((tmp.x + 1) / 2) * cols, row: ((1 - tmp.y) / 2) * rows };
  }

  /** Grid rows per world unit at a point's depth. */
  private rowsPerUnit(world: THREE.Vector3) {
    const d = this.camera.position.z - world.z;
    return ASCII_STYLE.grid.rows / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * d);
  }

  private onScreen(world: THREE.Vector3) {
    tmp.copy(world).project(this.camera);
    return Math.abs(tmp.x) < 1.3 && Math.abs(tmp.y) < 1.3 && tmp.z < 1;
  }

  dispose() {
    for (const s of this.shards) {
      this.overlay.remove(s.sprite);
      s.sprite.material.dispose();
    }
    this.shards.length = 0;
    this.bursts.length = 0;
    for (const s of this.sparks) this.scene.remove(s.mesh);
    this.sparks.length = 0;
    this.sparkGeo.dispose();
    this.sparkMat.dispose();
  }
}
