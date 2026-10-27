// PROTOTYPE ("Cockpit design" → Radar): four grid-only Radar designs, ?variant=A..D. Throwaway.
// Everything is drawn in the radar screen's own local coordinates and projected to grid cells, so
// it sits on the tilted panel; the sub-row nudge keeps slanted rows smooth.
import * as THREE from 'three';
import type { PaletteColor, TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { ShotState } from '../GameViewState';

export const RADAR_VARIANTS = [
  { key: 'A', name: 'Radar: track line, first letters' },
  { key: 'B', name: 'Radar: bars, one row per Shot' },
  { key: 'C', name: 'Radar: scope, enemy at center, sweep' },
  { key: 'D', name: 'Radar: lanes converging to the enemy' },
];
export type RadarKind = 'A' | 'B' | 'C' | 'D';

/** Live-tunable from the sandbox panel. */
export const RADAR_PROTO = { kind: 'A' as RadarKind };

/** Radar screen size in its local units (set by the cockpit to match the screen mesh). */
export const RADAR_SIZE = { w: 0.42, h: 0.26 };

const ENEMY = '<@>';
const v3 = new THREE.Vector3();

/** Projects radar-local (u, v) ∈ [-1, 1]² onto grid cells (v = +1 is the top of the screen). */
class RadarCanvas {
  constructor(
    private readonly text: TextGrid,
    private readonly screen: THREE.Object3D,
    private readonly camera: THREE.Camera,
  ) {
    screen.updateWorldMatrix(true, false);
  }

  /** Fractional grid position of a radar-local point. */
  grid(u: number, v: number) {
    const { cols, rows } = ASCII_STYLE.grid;
    this.screen.localToWorld(v3.set((u * RADAR_SIZE.w) / 2, (v * RADAR_SIZE.h) / 2, 0)).project(this.camera);
    return { col: ((v3.x + 1) / 2) * cols, row: ((1 - v3.y) / 2) * rows };
  }

  /** One glyph centered on a radar-local point. */
  plot(u: number, v: number, ch: string, color: PaletteColor) {
    const g = this.grid(u, v);
    const exact = g.row - 0.5;
    const row = Math.round(exact);
    this.text.write(Math.floor(g.col), row, ch, color, exact - row);
  }

  /**
   * A string starting at (u, v) going right along the panel's x axis, one column per char;
   * each char follows the panel's slant. Returns the u reached after the last char.
   */
  write(u: number, v: number, str: string, color: PaletteColor) {
    const a = this.grid(u, v);
    const b = this.grid(u + 0.1, v);
    const slope = (b.row - a.row) / (b.col - a.col);
    const c0 = Math.floor(a.col);
    [...str].forEach((ch, i) => {
      const col = c0 + i;
      const exact = a.row + slope * (col + 0.5 - a.col) - 0.5;
      const row = Math.round(exact);
      this.text.write(col, row, ch, color, exact - row);
    });
    return u + (str.length * 0.1) / (b.col - a.col);
  }

  /** Columns covered by the full radar width at height v. */
  span(v: number) {
    return { c0: Math.floor(this.grid(-1, v).col), c1: Math.floor(this.grid(1, v).col) };
  }

  /** Radar-local u of a column (inverse of grid() along v). */
  uAt(col: number, v: number) {
    const a = this.grid(-1, v);
    const b = this.grid(1, v);
    return -1 + (2 * (col + 0.5 - a.col)) / (b.col - a.col);
  }
}

/** Stable number per Shot (from its id) for spreading Shots over angles / lanes. */
const shotIndex = (s: ShotState) => Number(s.id.replace(/\D/g, '')) || 0;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const first = (s: ShotState) => [...s.word][0] ?? '*';

export function drawRadar(text: TextGrid, screen: THREE.Object3D, camera: THREE.Camera, shots: ShotState[], t: number) {
  const r = new RadarCanvas(text, screen, camera);
  ({ A: track, B: bars, C: scope, D: lanes })[RADAR_PROTO.kind](r, shots, t);
}

// ---------------------------------------------------------------- A
/** One line from the player ('|') to the Enemy ship; each Shot is its first letter at its Flight. */
function track(r: RadarCanvas, shots: ShotState[]) {
  const { c0, c1 } = r.span(0);
  const enemyStart = c1 - ENEMY.length;
  for (let col = c0 + 1; col < enemyStart; col++) r.plot(r.uAt(col, 0), 0, '.', 'dim');
  r.plot(r.uAt(c0, 0), 0, '|', 'dim');
  r.write(r.uAt(enemyStart, 0) - 0.02, 0, ENEMY, 'fg');
  for (const s of shots) {
    const col = Math.round(c0 + clamp01(s.flight) * (enemyStart - 1 - c0));
    r.plot(r.uAt(col, 0), 0, first(s), 'red');
  }
}

// ---------------------------------------------------------------- B
/** A row per Shot (closest to the enemy first): its word, then a bar filling toward the enemy. */
function bars(r: RadarCanvas, shots: ShotState[]) {
  const rows = [0.62, 0.22, -0.18, -0.58];
  r.write(0.62, 0.95, `ENEMY ${ENEMY}`, 'dim');
  const sorted = [...shots].sort((a, b) => b.flight - a.flight).slice(0, rows.length);
  if (sorted.length === 0) {
    r.write(-0.35, 0.02, 'no shots', 'dim');
    return;
  }
  sorted.forEach((s, i) => {
    const v = rows[i];
    const word = [...s.word].slice(0, 8).join('').padEnd(8, ' ');
    const u = r.write(-0.95, v, word, 'red');
    const { c1 } = r.span(v);
    const a = Math.ceil(r.grid(u, v).col) + 1;
    const len = Math.max(1, c1 - 1 - a);
    const filled = Math.round(clamp01(s.flight) * len);
    const bar = '='.repeat(Math.max(0, filled - 1)) + '>' + '.'.repeat(Math.max(0, len - filled)) + '|';
    r.write(r.uAt(a, v), v, bar, 'fg');
  });
  if (shots.length > rows.length) r.write(-0.95, -0.95, `+${shots.length - rows.length} more`, 'dim');
}

// ---------------------------------------------------------------- C
/** Classic scope: the Enemy ship at the center, range rings, a rotating sweep; Shots close in from the rim. */
function scope(r: RadarCanvas, shots: ShotState[], t: number) {
  // Circles in screen-ish proportions: radar units are 2:1 (w ≈ 2h), so u spans half as far as v.
  const ru = RADAR_SIZE.h / RADAR_SIZE.w;
  for (const rad of [0.95, 0.5]) {
    for (let a = 0; a < 360; a += rad > 0.6 ? 12 : 24) {
      const th = (a * Math.PI) / 180;
      r.plot(Math.cos(th) * rad * ru, Math.sin(th) * rad, '.', 'dim');
    }
  }
  const sweep = t * 2.2;
  for (let k = 1; k <= 6; k++) {
    const rad = (k / 6) * 0.95;
    r.plot(Math.cos(sweep) * rad * ru, Math.sin(sweep) * rad, k === 6 ? '+' : ':', 'fg');
  }
  for (const s of shots) {
    const th = (shotIndex(s) * 137.5 * Math.PI) / 180; // golden angle spreads Shots around the rim
    const rad = 0.95 * (1 - clamp01(s.flight)) + 0.12;
    r.plot(Math.cos(th) * rad * ru, Math.sin(th) * rad, first(s), 'red');
  }
  // Enemy ship last so the sweep never hides it.
  const c = Math.floor(r.grid(0, 0).col);
  r.write(r.uAt(c - 1, 0), 0, ENEMY, 'fg');
}

// ---------------------------------------------------------------- D
/** Reverse of the main view: 5 lanes from the player's edge (bottom) converge on the Enemy ship (top). */
function lanes(r: RadarCanvas, shots: ShotState[]) {
  const top = { u: 0, v: 0.78 };
  const bottoms = [-0.8, -0.4, 0, 0.4, 0.8];
  for (const bu of bottoms) {
    for (let k = 0; k <= 8; k++) {
      const f = k / 9;
      r.plot(bu + (top.u - bu) * f, -0.95 + (top.v + 0.95) * f, '.', 'dim');
    }
  }
  const e = r.grid(0, 0.92);
  r.write(r.uAt(Math.round(e.col) - 1, 0.92), 0.92, ENEMY, 'fg');
  for (const s of shots) {
    const bu = bottoms[shotIndex(s) % bottoms.length];
    const f = clamp01(s.flight) * 0.92;
    r.plot(bu + (top.u - bu) * f, -0.95 + (top.v + 0.95) * f, first(s), 'red');
  }
}
