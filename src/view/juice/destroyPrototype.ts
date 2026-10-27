// PROTOTYPE ("Juice: Word bullet destroyed"): the word breaks + a green explosion, ?variant=A..D.
// Shards are the same in every variant; variants differ in how / where the explosion is drawn.
import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import { paintGlyph, type WordSnapshot } from '../words/WordBulletSprites';

export const DESTROY_VARIANTS = [
  { key: 'A', name: 'Shards + grid ring burst (behind all words)' },
  { key: 'B', name: 'Shards + glyph particles at the word depth' },
  { key: 'C', name: 'Shards + grid debris scatter (behind all words)' },
  { key: 'D', name: 'Shards + 3D burst through the ASCII shader' },
];
export type DestroyKind = 'A' | 'B' | 'C' | 'D';

/** Live-tunable from the sandbox panel. */
export const DESTROY_PROTO = {
  kind: 'A' as DestroyKind,
  /** Shard speed, in word-heights per second (scaled by depth so it feels the same near or far). */
  shardSpeed: 9,
  /** Shard spin, radians / s. */
  shardSpin: 8,
  /** Explosion life, seconds. */
  burstSeconds: 0.5,
  /** Explosion size, in word-heights. */
  burstSize: 2.4,
  /** A green tracer shoots from the Cockpit to the word first; the word breaks when it lands. */
  projectile: true,
  /** Tracer travel time, seconds (quick). */
  projectileSeconds: 0.12,
};

/** Where the tracer leaves from: just above the yoke's Typed word screen (camera-local, see Cockpit.ts). */
const MUZZLE_LOCAL = new THREE.Vector3(0, -0.3, -1.35);

const ADVANCE = 0.6; // IBM Plex Mono advance / em
const GREEN = new THREE.Color(ASCII_STYLE.palette.green);
const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Line glyph for a screen direction (radians): - / | \ */
function lineGlyph(a: number) {
  const k = Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4;
  return ['-', '/', '|', '\\'][k];
}

/** `wait`: seconds left before the shard starts flying (held in place while the tracer travels). */
type Shard = { sprite: THREE.Sprite; vel: THREE.Vector3; spin: number; age: number; wait: number };
type Particle = { pos: THREE.Vector3; vel: THREE.Vector3; age: number; obj?: THREE.Object3D };
/** `delay`: tracer travel time before the explosion starts. */
type Burst = { center: THREE.Vector3; em: number; age: number; particles: Particle[]; seed: number; delay: number };

/** Glyph textures cached per char + color. */
const glyphCache = new Map<string, { map: THREE.CanvasTexture; aspect: number }>();
function glyphTexture(ch: string, color: string) {
  const key = `${ch}|${color}`;
  let g = glyphCache.get(key);
  if (!g) {
    const canvas = document.createElement('canvas');
    const aspect = paintGlyph(canvas, ch, color);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    g = { map, aspect };
    glyphCache.set(key, g);
  }
  return g;
}

export class DestroyFx {
  private readonly shards: Shard[] = [];
  private readonly bursts: Burst[] = [];
  private readonly sphereGeo = new THREE.SphereGeometry(1, 10, 8);
  private readonly sphereMat = new THREE.MeshBasicMaterial({ color: GREEN });

  constructor(
    /** Overlay scene (real font, over the ASCII frame). */
    private readonly overlay: THREE.Scene,
    /** Main 3D scene (goes through the ASCII shader). */
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  /** A Word bullet was destroyed: break it into flying letters and start the explosion. */
  burst(w: WordSnapshot) {
    const delay = DESTROY_PROTO.projectile ? DESTROY_PROTO.projectileSeconds : 0;
    const n = w.letters.length;
    const d = this.camera.position.z - w.center.z;
    w.letters.forEach((ch, i) => {
      const { map, aspect } = glyphTexture(ch, ASCII_STYLE.palette.fg);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
      const h = w.em * (map.image.height / 96);
      sprite.scale.set(h * aspect, h, 1);
      sprite.position.copy(w.center).add(tmp.set((i - (n - 1) / 2) * ADVANCE * w.em, 0, 0));
      // Outward from the word's center, plus randomness, so letters scatter in different directions.
      const out = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      const a = Math.atan2(Math.random() * 2 - 1 + 0.25, out + (Math.random() * 2 - 1) * 0.8);
      const speed = DESTROY_PROTO.shardSpeed * w.em * (0.7 + Math.random() * 0.6) * (d / 5);
      const vel = new THREE.Vector3(Math.cos(a) * speed, Math.sin(a) * speed, speed * 0.4);
      this.overlay.add(sprite);
      this.shards.push({ sprite, vel, spin: (Math.random() * 2 - 1) * DESTROY_PROTO.shardSpin, age: 0, wait: delay });
    });

    const b: Burst = { center: w.center.clone(), em: w.em, age: 0, particles: [], seed: Math.random() * 1000, delay };
    const kind = DESTROY_PROTO.kind;
    if (kind === 'B' || kind === 'C' || kind === 'D') {
      const count = kind === 'D' ? 18 : 26;
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2;
        const s = ((0.4 + Math.random() * 0.6) * 1.4 * DESTROY_PROTO.burstSize * w.em) / DESTROY_PROTO.burstSeconds;
        const p: Particle = { pos: w.center.clone(), vel: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, 0), age: 0 };
        if (kind === 'B') {
          const ch = ['*', '+', '.', '@'][k % 4];
          const { map, aspect } = glyphTexture(ch, ASCII_STYLE.palette.green);
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
          sp.scale.set(w.em * 0.8 * aspect, w.em * 0.8, 1);
          // Same distance as the word → three's transparent sort layers it between nearer / farther words.
          this.overlay.add(sp);
          p.obj = sp;
        } else if (kind === 'D') {
          const m = new THREE.Mesh(this.sphereGeo, this.sphereMat);
          m.scale.setScalar(w.em * 0.6);
          this.scene.add(m);
          p.obj = m;
        }
        b.particles.push(p);
      }
    }
    this.bursts.push(b);
  }

  update(dt: number, text: TextGrid) {
    // Shards: fly out fast, spin, gone once well off screen.
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      if (s.wait > 0) {
        s.wait -= dt; // the word holds still until the tracer hits it
        continue;
      }
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

    const life = DESTROY_PROTO.burstSeconds;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      if (b.age < b.delay) {
        this.drawTracer(text, b, b.age / b.delay);
        continue;
      }
      const k = (b.age - b.delay) / life;
      if (k >= 1) {
        for (const p of b.particles) this.dropParticle(p);
        this.bursts.splice(i, 1);
        continue;
      }
      if (DESTROY_PROTO.kind === 'A') this.drawRing(text, b, k);
      else if (DESTROY_PROTO.kind === 'C') this.drawDebris(text, b, k, dt);
      else {
        for (const p of b.particles) {
          p.pos.addScaledVector(p.vel, dt);
          // Drag scaled to the burst's life, so particles travel ~burstSize whatever the duration.
          p.vel.multiplyScalar(Math.max(0, 1 - (dt * 1.2) / DESTROY_PROTO.burstSeconds));
          p.obj?.position.copy(p.pos);
          if (p.obj instanceof THREE.Sprite) p.obj.material.opacity = 1 - k * k;
          if (p.obj instanceof THREE.Mesh) p.obj.scale.setScalar(b.em * 0.6 * (1 - k));
        }
      }
    }
  }

  /**
   * Green tracer in the grid from the Cockpit to the word: a bright head (`*`) with a short trail
   * drawn with the line glyph for its direction. Grid = behind every word.
   */
  private drawTracer(text: TextGrid, b: Burst, k: number) {
    const from = this.toGrid(tmp2.copy(MUZZLE_LOCAL).add(this.camera.position));
    const to = this.toGrid(b.center);
    const dx = to.col - from.col;
    const dy = to.row - from.row;
    const glyph = lineGlyph(Math.atan2(-dy, dx / CELL_ASPECT));
    const len = Math.hypot(dx / CELL_ASPECT, dy); // in rows
    const trail = 6;
    for (let t = 0; t <= trail; t++) {
      const kk = k - (t * 0.9) / Math.max(len, 1);
      if (kk < 0) break;
      text.write(Math.floor(from.col + dx * kk), Math.floor(from.row + dy * kk), t === 0 ? '*' : glyph, 'green');
    }
  }

  /** Grid ring: an expanding circle of green glyphs that thins out (behind every word). */
  private drawRing(text: TextGrid, b: Burst, k: number) {
    const g = this.toGrid(b.center);
    const rows = this.rowsPerUnit(b.center) * b.em * DESTROY_PROTO.burstSize;
    const r = 0.6 + rows * Math.sqrt(k);
    const ch = k < 0.25 ? '@' : k < 0.5 ? '*' : k < 0.75 ? '+' : '.';
    const step = Math.max(6, 40 / r);
    for (let deg = 0; deg < 360; deg += step) {
      if (k > 0.5 && (Math.sin(deg * 7 + b.seed) > 0.3)) continue; // ring breaks up as it fades
      const a = (deg * Math.PI) / 180;
      text.write(Math.floor(g.col + Math.cos(a) * r * CELL_ASPECT), Math.floor(g.row - Math.sin(a) * r), ch, 'green');
    }
    if (k < 0.2) text.write(Math.floor(g.col), Math.floor(g.row), '@', 'green');
  }

  /** Grid debris: green glyph particles scatter outward, decaying @ → * → + → . (behind every word). */
  private drawDebris(text: TextGrid, b: Burst, k: number, dt: number) {
    const unit = this.rowsPerUnit(b.center);
    const g = this.toGrid(b.center);
    for (const p of b.particles) {
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.max(0, 1 - (dt * 1.2) / DESTROY_PROTO.burstSeconds));
      const dx = (p.pos.x - b.center.x) * unit;
      const dy = (p.pos.y - b.center.y) * unit;
      const decay = k + (Math.sin(p.vel.x * 13 + b.seed) * 0.15);
      const ch = decay < 0.25 ? '@' : decay < 0.5 ? '*' : decay < 0.75 ? '+' : '.';
      text.write(Math.floor(g.col + dx * CELL_ASPECT), Math.floor(g.row - dy), ch, 'green');
    }
  }

  private dropParticle(p: Particle) {
    if (!p.obj) return;
    p.obj.removeFromParent();
    if (p.obj instanceof THREE.Sprite) p.obj.material.dispose();
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
    for (const b of this.bursts) for (const p of b.particles) this.dropParticle(p);
    this.sphereGeo.dispose();
    this.sphereMat.dispose();
  }
}
