// PROTOTYPE ("Juice: Shot hit"): Radar HIT!! + green burst at <@>, and a green explosion + dip on
// the Enemy ship, ?variant=A..C. Throwaway.
import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { Radar, RadarGeometry } from '../cockpit/Radar';
import type { EnemyShip } from '../enemy/EnemyShip';

export const SHOT_HIT_VARIANTS = [
  { key: 'A', name: 'HIT!! on Radar top + spark ring; green debris + springy dip' },
  { key: 'B', name: 'HIT!! next to <@> (green flash); big green grid explosion + slow sag' },
  { key: 'C', name: 'Big HIT!! over the scope; ship flashes green + tilted drop' },
];
export type ShotHitKind = 'A' | 'B' | 'C';

/** Live-tunable from the sandbox panel. */
export const SHOT_HIT_PROTO = {
  kind: 'A' as ShotHitKind,
  /** How long the whole effect lasts (s). */
  seconds: 0.9,
  /** Dip depth (world units at the Enemy ship). */
  dip: 1.2,
  /** Explosion size (world units at the Enemy ship). */
  boomSize: 3,
};

const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
const GREEN = ASCII_STYLE.palette.green;
const tmp = new THREE.Vector3();

type Piece = { mesh: THREE.Mesh; vel: THREE.Vector3 };

export class ShotHitFx {
  private age = Infinity;
  private pieces: Piece[] = [];
  private readonly mat = new THREE.MeshBasicMaterial({ color: GREEN });
  private readonly sphere = new THREE.SphereGeometry(1, 10, 8);
  private readonly ringCenter = new THREE.Vector3();
  private seed = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly enemy: EnemyShip,
    radar: Radar,
  ) {
    radar.overlay = (text, g) => this.drawRadar(text, g);
  }

  /** A Shot reached the Enemy ship. */
  hit() {
    this.age = 0;
    const kind = SHOT_HIT_PROTO.kind;
    this.ringCenter.copy(this.enemy.root.position);
    this.seed = Math.random() * 100;
    if (kind === 'A' || kind === 'C') {
      const n = kind === 'A' ? 20 : 8;
      const size = SHOT_HIT_PROTO.boomSize;
      // In front of the ship so it isn't hidden inside the hull.
      const center = this.enemy.root.position.clone().add(new THREE.Vector3(0, 0, 3));
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.4).normalize();
        const mesh = new THREE.Mesh(this.sphere, this.mat);
        mesh.position.copy(center);
        mesh.scale.setScalar(size * 0.14);
        this.scene.add(mesh);
        this.pieces.push({ mesh, vel: dir.multiplyScalar(((0.6 + Math.random()) * size * 1.4) / (SHOT_HIT_PROTO.seconds * 0.6)) });
      }
    }
  }

  /** Enemy dip / tint + debris; `text` for the grid ring (variant B). Call before the Cockpit. */
  update(dt: number, text: TextGrid) {
    const T = SHOT_HIT_PROTO.seconds;
    for (const p of this.pieces) {
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.max(0, 1 - (dt * 2) / T));
      p.mesh.scale.multiplyScalar(1 - (dt * 1.4) / T);
    }
    if (this.age >= T) {
      this.enemy.effectOffset.set(0, 0, 0);
      this.enemy.effectRoll = 0;
      this.enemy.tint(null);
      for (const p of this.pieces) this.scene.remove(p.mesh);
      this.pieces = [];
      return;
    }
    this.age += dt;
    const k = Math.min(1, this.age / T);
    const kind = SHOT_HIT_PROTO.kind;
    const dip = SHOT_HIT_PROTO.dip;

    if (kind === 'A') {
      // Quick drop, springy recovery.
      this.enemy.effectOffset.y = -dip * Math.exp(-k * 5) * Math.cos(k * 14) * Math.min(1, k * 12);
    } else if (kind === 'B') {
      // Slow sag: down over the first third, ease back up.
      const down = k < 0.33 ? Math.sin((k / 0.33) * (Math.PI / 2)) : Math.cos(((k - 0.33) / 0.67) * (Math.PI / 2));
      this.enemy.effectOffset.y = -dip * down;
      this.drawShipRing(text, k);
    } else {
      // Drop with a wobbling tilt; the ship flashes green.
      this.enemy.effectOffset.y = -dip * Math.exp(-k * 4) * Math.min(1, k * 10);
      this.enemy.effectRoll = Math.sin(k * 30) * 0.35 * (1 - k);
      this.enemy.tint(Math.floor(k * 10) % 2 === 0 && k < 0.6 ? GREEN : null);
    }
  }

  /** Variant B: an expanding green ring of grid glyphs over the Enemy ship. */
  /**
   * Variant B: a big filled green explosion of grid glyphs over the Enemy ship. Dense at the
   * center (@ #), lighter outward (* + .); it grows fast, then thins out and breaks apart.
   */
  private drawShipRing(text: TextGrid, k: number) {
    const { cols, rows } = ASCII_STYLE.grid;
    tmp.copy(this.ringCenter).project(this.camera);
    const col = ((tmp.x + 1) / 2) * cols;
    const row = ((1 - tmp.y) / 2) * rows;
    const R = SHOT_HIT_PROTO.boomSize * 2.6 * Math.min(1, Math.sqrt(k / 0.35)); // radius in rows
    const ramp = '.+*#@';
    for (let r = Math.floor(row - R) - 1; r <= row + R + 1; r++) {
      for (let c = Math.floor(col - R * CELL_ASPECT) - 1; c <= col + R * CELL_ASPECT + 1; c++) {
        const d = Math.hypot((c + 0.5 - col) / CELL_ASPECT, r + 0.5 - row) / Math.max(R, 0.01);
        if (d > 1) continue;
        // Stable per-cell noise so the shape is ragged and breaks up instead of shrinking evenly.
        const n = Math.abs(Math.sin(c * 12.9898 + r * 78.233 + this.seed) * 43758.5453) % 1;
        const heat = (1 - d) * (1.2 - k) + n * 0.35 - k * 0.6;
        if (heat <= 0.05) continue;
        text.write(c, r, ramp[Math.min(ramp.length - 1, Math.floor(heat * ramp.length))], 'green');
      }
    }
  }

  /** Radar overlay: HIT!! and a green burst around <@>, per variant. */
  private drawRadar(text: TextGrid, g: RadarGeometry) {
    const T = SHOT_HIT_PROTO.seconds;
    if (this.age >= T) return;
    const k = this.age / T;
    const blink = Math.floor(k * 8) % 2 === 0;
    const ex = Math.floor(g.cx) - 1; // enemy '<@>' starts here
    const ey = Math.floor(g.cy);
    const kind = SHOT_HIT_PROTO.kind;

    if (kind === 'A') {
      if (blink) text.write(Math.round((g.c0 + g.c1) / 2) - 2, g.r0, 'HIT!!', 'green');
      const r = 0.8 + 2.2 * k;
      for (let deg = 0; deg < 360; deg += 30) {
        const a = (deg * Math.PI) / 180;
        text.write(Math.floor(g.cx + Math.cos(a) * r * CELL_ASPECT), Math.floor(g.cy - Math.sin(a) * r), k < 0.5 ? '*' : '.', 'green');
      }
      text.write(ex, ey, '<@>', 'fg');
    } else if (kind === 'B') {
      text.write(ex + 4, ey, 'HIT!!', 'green');
      text.write(ex, ey, '<@>', blink ? 'green' : 'fg');
      if (k < 0.5) {
        text.write(ex + 1, ey - 1, '*', 'green');
        text.write(ex + 1, ey + 1, '*', 'green');
      }
    } else {
      if (k < 0.45) {
        if (blink) {
          const word = 'H I T ! !';
          text.fill(Math.round(g.cx - word.length / 2) - 1, ey, word.length + 2, 1, ' ');
          text.write(Math.round(g.cx - word.length / 2), ey, word, 'green');
        }
      } else {
        const r = 0.8 + 2.5 * ((k - 0.45) / 0.55);
        for (let deg = 0; deg < 360; deg += 24) {
          const a = (deg * Math.PI) / 180;
          text.write(Math.floor(g.cx + Math.cos(a) * r * CELL_ASPECT), Math.floor(g.cy - Math.sin(a) * r), '+', 'green');
        }
        text.write(ex, ey, '<@>', 'green');
      }
    }
  }

  dispose() {
    for (const p of this.pieces) this.scene.remove(p.mesh);
    this.mat.dispose();
    this.sphere.dispose();
  }
}
