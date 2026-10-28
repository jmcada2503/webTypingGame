// PROTOTYPE ("Juice: Pace-driven motion"): stars + Enemy ship react to both players' Pace,
// ?variant=A..C. Throwaway.
//   star speed (magnitude) ← player Pace;  direction ← sign(player − enemy)
//   Enemy ship size ← |player − enemy| (big gap = big ship: one is closing in on the other)
import type { EnemyShip } from '../enemy/EnemyShip';
import { STAR_DRIFT } from '../enemy/StarDrift';

export const PACE_VARIANTS = [
  { key: 'A', name: 'Direct: linear speed, quick flip, linear scale' },
  { key: 'B', name: 'Smooth: saturating speed, blended direction, slow scale + dead zone' },
  { key: 'C', name: 'Momentum + distance: inertia stars, ship flies closer / farther' },
];
export type PaceKind = 'A' | 'B' | 'C';

/** Live-tunable from the sandbox panel. */
export const PACE_PROTO = {
  kind: 'A' as PaceKind,
  /** Star speed (world units / s) per char / s of player Pace. */
  speedPerPace: 1.4,
  /** Gap (chars / s) at which the ship reaches its biggest. */
  maxGap: 4,
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

export class PaceMotion {
  private speed = 0;
  private grow = 0;

  constructor(private readonly enemy: EnemyShip) {}

  update(pace: { player: number; enemy: number }, dt: number) {
    const d = pace.player - pace.enemy;
    const gap = Math.abs(d);
    const { speedPerPace, maxGap, maxGrow } = PACE_PROTO;
    let target: number;
    let growTarget: number;

    if (PACE_PROTO.kind === 'A') {
      target = (d >= 0 ? 1 : -1) * speedPerPace * pace.player;
      this.speed += (target - this.speed) * follow(dt, 0.4);
      growTarget = clamp01(gap / maxGap);
      this.grow += (growTarget - this.grow) * follow(dt, 0.4);
      this.enemy.effectScale = 1 + maxGrow * this.grow;
      this.enemy.effectOffset.z = 0;
    } else if (PACE_PROTO.kind === 'B') {
      // Fast typists saturate; direction blends through 0 (equal Pace = stars ease to a stop).
      const mag = speedPerPace * 6 * (1 - Math.exp(-pace.player / 5));
      target = Math.tanh(d / 1.5) * mag;
      this.speed += (target - this.speed) * follow(dt, 0.8);
      growTarget = smoothstep(0.5, maxGap, gap); // tiny gaps don't move the ship
      this.grow += (growTarget - this.grow) * follow(dt, 1.5);
      this.enemy.effectScale = 1 + maxGrow * this.grow;
      this.enemy.effectOffset.z = 0;
    } else {
      // Stars with inertia; the ship actually flies closer (bigger) / farther instead of scaling.
      target = Math.tanh(d / 1) * speedPerPace * pace.player;
      this.speed += (target - this.speed) * follow(dt, 1.2);
      growTarget = clamp01(gap / maxGap);
      this.grow += (growTarget - this.grow) * follow(dt, 1);
      this.enemy.effectScale = 1;
      this.enemy.effectOffset.z = 18 * maxGrow * this.grow; // toward the camera
    }
    STAR_DRIFT.speed = this.speed;
  }
}
