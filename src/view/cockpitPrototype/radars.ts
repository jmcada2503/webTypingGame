// PROTOTYPE ("Cockpit design" → Radar): grid-only Radar designs, ?variant=A|C. Throwaway.
// The radar screen is tilted, but grid glyphs can't be: each design is drawn upright inside the
// largest grid-aligned rectangle that fits in the screen's projected outline (the black screen
// keeps its tilted shape around it), so every glyph sits exactly on the grid.
import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { ShotState } from '../GameViewState';

export const RADAR_VARIANTS = [
  { key: 'A', name: 'Radar: track line, first letters' },
  { key: 'C', name: 'Radar: scope, enemy at center, sweep' },
];
export type RadarKind = 'A' | 'C';

/** Live-tunable from the sandbox panel. */
export const RADAR_PROTO = { kind: 'A' as RadarKind };

/** Radar screen size in its local units (the cockpit builds the screen mesh from it). */
export const RADAR_SIZE = { w: 0.42, h: 0.3 };

const ENEMY = '<@>';
/** Cell height / width: a circle needs this many more columns than rows across. */
const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
const v3 = new THREE.Vector3();

/** Grid-aligned rectangle (inclusive cells) inside the screen's projected quad. */
type Box = { c0: number; r0: number; c1: number; r1: number };

function innerBox(screen: THREE.Object3D, camera: THREE.Camera): Box {
  const { cols, rows } = ASCII_STYLE.grid;
  screen.updateWorldMatrix(true, false);
  const pts = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    screen.localToWorld(v3.set((u * RADAR_SIZE.w) / 2, (v * RADAR_SIZE.h) / 2, 0)).project(camera);
    return { col: ((v3.x + 1) / 2) * cols, row: ((1 - v3.y) / 2) * rows };
  });
  const xs = pts.map((p) => p.col).sort((a, b) => a - b);
  const ys = pts.map((p) => p.row).sort((a, b) => a - b);
  // Second-smallest / second-largest: the rectangle stays inside the tilted quad.
  return { c0: Math.ceil(xs[1]), c1: Math.floor(xs[2]) - 1, r0: Math.ceil(ys[1]), r1: Math.floor(ys[2]) - 1 };
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const first = (s: ShotState) => [...s.word][0] ?? '*';
/** Stable number per Shot (from its id) for spreading Shots around the scope. */
const shotIndex = (s: ShotState) => Number(s.id.replace(/\D/g, '')) || 0;

export function drawRadar(text: TextGrid, screen: THREE.Object3D, camera: THREE.Camera, shots: ShotState[], t: number) {
  const box = innerBox(screen, camera);
  if (box.c1 - box.c0 < 6 || box.r1 < box.r0) return;
  (RADAR_PROTO.kind === 'C' ? scope : track)(text, box, shots, t);
}

// ---------------------------------------------------------------- A
/**
 * Track: one straight row from the player ('|') to the Enemy ship ('<@>'), dots between; each
 * Shot is its word's first letter in red at its Flight. A dim tick row under it marks quarters.
 */
function track(text: TextGrid, b: Box, shots: ShotState[]) {
  const row = Math.round((b.r0 + b.r1) / 2);
  const start = b.c0 + 1;
  const enemyAt = b.c1 - ENEMY.length; // enemy occupies enemyAt .. enemyAt + 2
  const last = enemyAt - 1; // furthest column a Shot reaches
  text.write(start, row, '|', 'dim');
  for (let c = start + 1; c <= last; c++) text.write(c, row, '.', 'dim');
  text.write(enemyAt, row, ENEMY, 'fg');
  if (row + 1 <= b.r1) {
    for (let q = 1; q < 4; q++) text.write(Math.round(start + ((last - start) * q) / 4), row + 1, "'", 'dim');
  }
  for (const s of shots) {
    const c = Math.round(start + clamp01(s.flight) * (last - start));
    text.write(c, row, first(s), 'red');
  }
}

// ---------------------------------------------------------------- C
/** Line glyph for a direction (radians): -, /, |, \ . */
function lineGlyph(a: number) {
  const k = Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4;
  return ['-', '/', '|', '\\'][k];
}

/**
 * Scope: the Enemy ship at the center, two one-cell-thick range rings and a rotating sweep line
 * (drawn with -/|\ by its angle, with a dim trail), columns stretched by the cell aspect so
 * circles look round. Shots move in from the outer ring toward the enemy as their Flight grows.
 */
function scope(text: TextGrid, b: Box, shots: ShotState[], t: number) {
  const cx = (b.c0 + b.c1 + 1) / 2;
  const cy = (b.r0 + b.r1 + 1) / 2;
  // Radius in rows, limited by both the height and the (aspect-corrected) width.
  const R = Math.min((b.r1 - b.r0 + 1) / 2, (b.c1 - b.c0 + 1) / 2 / CELL_ASPECT) - 0.3;
  const cell = (rad: number, a: number) => ({
    c: Math.floor(cx + Math.cos(a) * rad * CELL_ASPECT),
    r: Math.floor(cy - Math.sin(a) * rad),
  });
  const inBox = (p: { c: number; r: number }) => p.c >= b.c0 && p.c <= b.c1 && p.r >= b.r0 && p.r <= b.r1;

  for (const [rad, step] of [
    [R, 3],
    [R / 2, 8],
  ] as const) {
    for (let deg = 0; deg < 360; deg += step) {
      const p = cell(rad, (deg * Math.PI) / 180);
      if (inBox(p)) text.write(p.c, p.r, '.', 'dim');
    }
  }
  const sweep = (t * 1.6) % (Math.PI * 2);
  for (const [a, color] of [
    [sweep - 0.5, 'dim'],
    [sweep - 0.25, 'dim'],
    [sweep, 'fg'],
  ] as const) {
    for (let rad = 0.9; rad < R; rad += 0.35) {
      const p = cell(rad, a);
      if (inBox(p)) text.write(p.c, p.r, color === 'fg' ? lineGlyph(a) : '.', color);
    }
  }
  for (const s of shots) {
    const th = (shotIndex(s) * 137.5 * Math.PI) / 180; // golden angle spreads Shots around
    const p = cell(R * (1 - clamp01(s.flight)) + 0.8, th);
    if (inBox(p)) text.write(p.c, p.r, first(s), 'red');
  }
  text.write(Math.floor(cx) - 1, Math.floor(cy), ENEMY, 'fg');
}
