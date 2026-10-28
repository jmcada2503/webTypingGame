import * as THREE from 'three';
import type { TextGrid } from '../../render/AsciiRenderer';
import { ASCII_STYLE } from '../../render/asciiStyle';
import type { ShotState } from '../GameViewState';
import { worldToGrid } from './gridProjection';

/** Radar screen size in its panel's local units. */
export const RADAR_SIZE = { w: 0.42, h: 0.3 };

const ENEMY = '<@>';
/** Cell height / width: a circle needs this many more columns than rows across. */
const CELL_ASPECT = ASCII_STYLE.referenceCell.height / ASCII_STYLE.referenceCell.width;
const SWEEP_SPEED = 1.6; // radians / s
/** How long a defended Shot's `x` stays on the scope (s). */
const DEFENDED_SECONDS = 0.5;
const v3 = new THREE.Vector3();

type Box = { c0: number; r0: number; c1: number; r1: number };

/**
 * The Radar ("Cockpit design"): a scope on the right console, drawn in grid glyphs only.
 * The screen is tilted but glyphs can't be, so the scope is drawn upright inside the largest
 * grid-aligned box within the screen's projected outline.
 *
 * Enemy ship `<@>` at the center, two one-cell-thick range rings, a rotating sweep line (-/|\ by
 * angle, dim trail). Each Shot is its word's first letter (red), moving from the outer ring to the
 * enemy as its Flight grows; it disappears when it leaves the snapshot (hit or defended).
 */
/** Geometry handed to Radar overlays (in grid cells). */
export type RadarGeometry = { c0: number; r0: number; c1: number; r1: number; cx: number; cy: number; R: number };

export class Radar {
  private t = 0;
  /** Where each Shot was last drawn (scope-relative: angle + radius in R), for its defended mark. */
  private readonly lastSeen = new Map<string, { angle: number; rad: number }>();
  /** Defended Shots: a dim `x` where they were, for DEFENDED_SECONDS. */
  private ghosts: { angle: number; rad: number; age: number }[] = [];
  /** Drawn last, over the scope (e.g. the Shot-hit HIT!!). */
  overlay?: (text: TextGrid, g: RadarGeometry, dt: number) => void;

  private readonly pendingDefended = new Set<string>();

  constructor(private readonly screen: THREE.Object3D) {}

  /** The opponent destroyed this Shot: it leaves a dim `x` on the scope for a moment. */
  defended(id: string) {
    this.pendingDefended.add(id);
  }

  draw(text: TextGrid, camera: THREE.Camera, shots: ShotState[], dt: number) {
    this.t += dt;
    const b = this.innerBox(camera);
    if (b.c1 - b.c0 < 6 || b.r1 < b.r0) return;

    const cx = (b.c0 + b.c1 + 1) / 2;
    const cy = (b.r0 + b.r1 + 1) / 2;
    // Radius in rows, limited by the height and the aspect-corrected width.
    const R = Math.min((b.r1 - b.r0 + 1) / 2, (b.c1 - b.c0 + 1) / 2 / CELL_ASPECT) - 0.3;
    const cellAt = (rad: number, a: number) => ({
      c: Math.floor(cx + Math.cos(a) * rad * CELL_ASPECT),
      r: Math.floor(cy - Math.sin(a) * rad),
    });
    const put = (p: { c: number; r: number }, ch: string, color: 'fg' | 'dim' | 'red') => {
      if (p.c >= b.c0 && p.c <= b.c1 && p.r >= b.r0 && p.r <= b.r1) text.write(p.c, p.r, ch, color);
    };

    for (const [rad, stepDeg] of [
      [R, 3],
      [R / 2, 8],
    ] as const) {
      for (let deg = 0; deg < 360; deg += stepDeg) put(cellAt(rad, (deg * Math.PI) / 180), '.', 'dim');
    }

    const sweep = (this.t * SWEEP_SPEED) % (Math.PI * 2);
    for (const [a, bright] of [
      [sweep - 0.5, false],
      [sweep - 0.25, false],
      [sweep, true],
    ] as const) {
      for (let rad = 0.9; rad < R; rad += 0.35) put(cellAt(rad, a), bright ? lineGlyph(a) : '.', bright ? 'fg' : 'dim');
    }

    const alive = new Set<string>();
    for (const s of shots) {
      const angle = (shotIndex(s) * 137.5 * Math.PI) / 180; // golden angle spreads Shots around
      const flight = Math.min(Math.max(s.flight, 0), 1);
      const rad = (R - 0.8) * (1 - flight) + 0.8; // from the outer ring (flight 0) in to the enemy
      put(cellAt(rad, angle), [...s.word][0] ?? '*', 'red');
      this.lastSeen.set(s.id, { angle, rad });
      alive.add(s.id);
    }
    for (const id of this.lastSeen.keys()) if (!alive.has(id) && !this.pendingDefended.has(id)) this.lastSeen.delete(id);
    for (const id of this.pendingDefended) {
      const at = this.lastSeen.get(id);
      if (at) this.ghosts.push({ ...at, age: 0 });
      this.lastSeen.delete(id);
    }
    this.pendingDefended.clear();
    this.ghosts = this.ghosts.filter((g) => (g.age += dt) < DEFENDED_SECONDS);
    for (const g of this.ghosts) put(cellAt(g.rad, g.angle), 'x', 'dim');

    text.write(Math.floor(cx) - 1, Math.floor(cy), ENEMY, 'fg');
    this.overlay?.(text, { ...b, cx, cy, R }, dt);
  }

  /** Grid-aligned box inside the screen's projected quad (2nd-smallest / 2nd-largest corners). */
  private innerBox(camera: THREE.Camera): Box {
    this.screen.updateWorldMatrix(true, false);
    const pts = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => worldToGrid(this.screen.localToWorld(v3.set((u * RADAR_SIZE.w) / 2, (v * RADAR_SIZE.h) / 2, 0)), camera));
    const xs = pts.map((p) => p.col).sort((a, b) => a - b);
    const ys = pts.map((p) => p.row).sort((a, b) => a - b);
    return { c0: Math.ceil(xs[1]), c1: Math.floor(xs[2]) - 1, r0: Math.ceil(ys[1]), r1: Math.floor(ys[2]) - 1 };
  }
}

/** Line glyph for a screen direction (radians): - / | \ */
function lineGlyph(a: number) {
  const k = Math.round((((a % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4)) % 4;
  return ['-', '/', '|', '\\'][k];
}

/** Stable number per Shot (from its id) for spreading Shots around the scope. */
function shotIndex(s: ShotState) {
  return Number(s.id.replace(/\D/g, '')) || 0;
}
