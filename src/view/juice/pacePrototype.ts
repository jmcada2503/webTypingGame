// PROTOTYPE ("Juice: Pace-driven motion"): stars + Enemy ship react to both players' Pace,
// ?variant=A..C. Throwaway.
//   star speed (magnitude) ← player Pace;  direction ← sign(player − enemy)
//   Enemy ship size ← |player − enemy| (big gap = big ship: one is closing in on the other)
// Calibrated on the user's own Pace test: 4 chars/s = fast; 8 chars/s = the limit (super fast).
import type { EnemyShip } from '../enemy/EnemyShip';
import { STAR_DRIFT } from '../enemy/StarDrift';

export const PACE_VARIANTS = [
  { key: 'A', name: 'Direct: speed follows Pace, quick flip, linear scale' },
  { key: 'B', name: 'Smooth: blended direction, slow scale + dead zone' },
  { key: 'C', name: 'Momentum + distance: inertia stars, ship flies closer / farther' },
];
export type PaceKind = 'A' | 'B' | 'C';

/** Live-tunable from the sandbox panel. Paces in chars/s, star speeds in world units/s. */
export const PACE_PROTO = {
  kind: 'A' as PaceKind,
  /** A fast typist (the user's measured Pace). Stars move fast here. */
  fast: 4,
  /** The Pace limit: stars move super fast here; faster Paces count as this. */
  limit: 8,
  /** Star speed at `fast` and at `limit` (old idle drift was 6). */
  starsAtFast: 20,
  starsAtLimit: 50,
  /** Pace gap (chars/s) at which the ship reaches its biggest. */
  maxGap: 2,
  /** Extra ship size at the max gap (0.7 = 70 % bigger). */
  maxGrow: 0.7,
};

/** Exponential approach factor for a smoothing time `tau` (s). */
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** How fast the stars fly for a player Pace: 0 → still, fast → fast, limit → super fast (capped). */
export function starSpeedFor(pace: number) {
  const { fast, limit, starsAtFast, starsAtLimit } = PACE_PROTO;
  const p = Math.min(Math.max(pace, 0), limit);
  if (p <= fast) return (starsAtFast * p) / fast;
  return starsAtFast + ((starsAtLimit - starsAtFast) * (p - fast)) / (limit - fast);
}

export class PaceMotion {
  private speed = 0;
  private grow = 0;

  constructor(private readonly enemy: EnemyShip) {}

  update(pace: { player: number; enemy: number }, dt: number) {
    const { limit, maxGap, maxGrow } = PACE_PROTO;
    const player = Math.min(pace.player, limit);
    const enemy = Math.min(pace.enemy, limit);
    const d = player - enemy;
    const gap = Math.abs(d);
    const mag = starSpeedFor(player);
    let target: number;
    let growTarget: number;

    if (PACE_PROTO.kind === 'A') {
      target = (d >= 0 ? 1 : -1) * mag;
      this.speed += (target - this.speed) * follow(dt, 0.4);
      growTarget = clamp01(gap / maxGap);
      this.grow += (growTarget - this.grow) * follow(dt, 0.4);
      this.enemy.effectScale = 1 + maxGrow * this.grow;
      this.enemy.effectOffset.z = 0;
    } else if (PACE_PROTO.kind === 'B') {
      // Direction blends through 0: near-equal Paces (within ~0.6 chars/s) ease the stars to a stop.
      target = Math.tanh(d / 0.6) * mag;
      this.speed += (target - this.speed) * follow(dt, 0.8);
      growTarget = smoothstep(0.4, maxGap, gap); // gaps under 0.4 chars/s don't move the ship
      this.grow += (growTarget - this.grow) * follow(dt, 1.5);
      this.enemy.effectScale = 1 + maxGrow * this.grow;
      this.enemy.effectOffset.z = 0;
    } else {
      // Stars with inertia; the ship actually flies closer (bigger) / farther instead of scaling.
      target = Math.tanh(d / 0.4) * mag;
      this.speed += (target - this.speed) * follow(dt, 1.2);
      growTarget = clamp01(gap / maxGap);
      this.grow += (growTarget - this.grow) * follow(dt, 1);
      this.enemy.effectScale = 1;
      this.enemy.effectOffset.z = 18 * maxGrow * this.grow; // toward the camera
    }
    STAR_DRIFT.speed = this.speed;
  }
}
