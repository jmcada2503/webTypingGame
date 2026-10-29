import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { Radar, RadarGeometry } from '../cockpit/Radar';
import type { EnemyShip } from '../enemy/EnemyShip';

/** Live-tunable from the sandbox panel. */
export const SHOT_HIT_LOOK = {
  /** How long the whole effect lasts (s). */
  seconds: 0.9,
  /** How far the Enemy ship sags (world units). */
  dip: 1.2,
  /** Explosion size (main cloud radius ≈ boomSize × 2.6 grid rows). */
  boomSize: 3,
};

const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
/** Glyphs from cool edge to hot core. */
const HEAT_RAMP = '.+*#@';
const tmp = new THREE.Vector3();

/**
 * One cloud of the explosion, in grid units relative to the blast center. Its outline is lumpy
 * (two random sine lobes), it appears after `delay` (fraction of the effect) and drifts outward.
 */
type Puff = { dx: number; dy: number; radius: number; delay: number; p1: number; p2: number; drift: number };

/**
 * Shot hit ("Juice: Shot hit"), when a Shot reaches the Enemy ship:
 * - **Radar:** `HIT!!` in green next to `<@>`, which flashes green (plus a quick spark above/below).
 * - **Enemy ship:** a big green explosion of grid glyphs, made of several lumpy, overlapping puffs
 *   (not a clean circle), hot in the middle (`@ #`) and cooler outward (`* + .`). It grows fast,
 *   then thins and breaks apart. The ship sags under it and eases back.
 */
export class ShotHitFx {
  private age = Infinity;
  private puffs: Puff[] = [];
  private seed = 0;
  /** Size of the explosion being drawn (SHOT_HIT_LOOK.boomSize unless a bigger one was asked for). */
  private size = SHOT_HIT_LOOK.boomSize;
  private readonly center = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly enemy: EnemyShip,
    radar: Radar,
  ) {
    radar.overlay = (text, g) => this.drawRadar(text, g);
  }

  /** A Shot reached the Enemy ship. */
  /** `boomSize` makes this one bigger than a normal hit (the Enemy ship's destruction). */
  hit(boomSize = SHOT_HIT_LOOK.boomSize) {
    this.size = boomSize;
    this.age = 0;
    this.seed = Math.random() * 100;
    this.center.copy(this.enemy.root.position);
    const R = this.size * 2.6;
    const rnd = () => Math.random();
    this.puffs = [{ dx: 0, dy: 0, radius: R, delay: 0, p1: rnd() * 6.3, p2: rnd() * 6.3, drift: 0 }];
    const extra = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < extra; i++) {
      const a = rnd() * Math.PI * 2;
      const dist = R * (0.35 + rnd() * 0.45);
      this.puffs.push({
        dx: Math.cos(a) * dist,
        dy: Math.sin(a) * dist * 0.8,
        radius: R * (0.3 + rnd() * 0.35),
        delay: rnd() * 0.25,
        p1: rnd() * 6.3,
        p2: rnd() * 6.3,
        drift: R * (0.15 + rnd() * 0.25),
      });
    }
  }

  /** Enemy sag + explosion. Call every frame before the Cockpit draws (its text wins). */
  update(dt: number, text: TextGrid) {
    const T = SHOT_HIT_LOOK.seconds;
    if (this.age >= T) {
      this.enemy.effectOffset.y = 0; // only the sag axis is ours
      return;
    }
    this.age += dt;
    const k = Math.min(1, this.age / T);
    // Slow sag: down over the first third, ease back up.
    const down = k < 0.33 ? Math.sin((k / 0.33) * (Math.PI / 2)) : Math.cos(((k - 0.33) / 0.67) * (Math.PI / 2));
    this.enemy.effectOffset.y = -SHOT_HIT_LOOK.dip * down;
    this.drawExplosion(text, k);
  }

  private drawExplosion(text: TextGrid, k: number) {
    const { cols, rows } = ASCII_STYLE.grid;
    tmp.copy(this.center).project(this.camera);
    const col = ((tmp.x + 1) / 2) * cols;
    const row = ((1 - tmp.y) / 2) * rows;
    const maxR = this.size * 2.6 * 1.9;

    for (let r = Math.floor(row - maxR); r <= row + maxR; r++) {
      for (let c = Math.floor(col - maxR * CELL_ASPECT); c <= col + maxR * CELL_ASPECT; c++) {
        const x = (c + 0.5 - col) / CELL_ASPECT; // grid → round units (rows)
        const y = -(r + 0.5 - row);
        let heat = 0;
        for (const p of this.puffs) {
          const pk = (k - p.delay) / (1 - p.delay);
          if (pk <= 0) continue;
          const grow = Math.min(1, Math.sqrt(pk / 0.35));
          const out = p.drift * pk; // puff drifts away from the center
          const len = Math.hypot(p.dx, p.dy) || 1;
          const px = p.dx + (p.dx / len) * out;
          const py = p.dy + (p.dy / len) * out;
          const ang = Math.atan2(y - py, x - px);
          const lumpy = 1 + 0.3 * Math.sin(3 * ang + p.p1) + 0.18 * Math.sin(5 * ang + p.p2);
          const d = Math.hypot(x - px, y - py) / (p.radius * grow * lumpy);
          if (d < 1) heat = Math.max(heat, (1 - d) * (1.2 - pk));
        }
        if (heat <= 0) continue;
        // Stable per-cell noise: ragged edges, and the cloud breaks apart instead of shrinking evenly.
        const n = Math.abs(Math.sin(c * 12.9898 + r * 78.233 + this.seed) * 43758.5453) % 1;
        const h = heat + n * 0.35 - k * 0.55;
        if (h <= 0.05) continue;
        text.write(c, r, HEAT_RAMP[Math.min(HEAT_RAMP.length - 1, Math.floor(h * HEAT_RAMP.length))], 'green');
      }
    }
  }

  /** Radar overlay: HIT!! next to <@>, which flashes green; quick sparks above / below. */
  private drawRadar(text: TextGrid, g: RadarGeometry) {
    const T = SHOT_HIT_LOOK.seconds;
    if (this.age >= T) return;
    const k = this.age / T;
    const blink = Math.floor(k * 8) % 2 === 0;
    const ex = Math.floor(g.cx) - 1; // '<@>' starts here
    const ey = Math.floor(g.cy);
    text.write(ex + 4, ey, 'HIT!!', 'green');
    text.write(ex, ey, '<@>', blink ? 'green' : 'fg');
    if (k < 0.5) {
      text.write(ex + 1, ey - 1, '*', 'green');
      text.write(ex + 1, ey + 1, '*', 'green');
    }
  }

  dispose() {
    this.enemy.effectOffset.y = 0;
  }
}
