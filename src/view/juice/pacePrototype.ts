// PROTOTYPE ("Juice: Pace-driven motion"): stars + Enemy ship react to both players' Pace,
// ?variant=A..C. Throwaway.
//   star speed (magnitude) ← player Pace;  direction ← sign(player − enemy)
//   Enemy ship size ← enemy − player: enemy ahead = bigger, player ahead = smaller, equal = normal
// Pace = correct words per minute. Calibrated on the user's Pace test (4 chars/s ≈ 33 words/min
// with the sample words, avg 7.3 chars): 33 = fast; 66 = the limit (super fast).
import type { EnemyShip } from '../enemy/EnemyShip';
import { STAR_DRIFT } from '../enemy/StarDrift';

export const PACE_VARIANTS = [
  { key: 'A', name: 'Direct: speed follows Pace, quick flip, linear scale' },
  { key: 'B', name: 'Smooth: blended direction, slow scale + dead zone' },
  { key: 'C', name: 'Momentum + distance: inertia stars, ship flies closer / farther' },
];
export type PaceKind = 'A' | 'B' | 'C';

/** Live-tunable from the sandbox panel. Paces in correct words / min, star speeds in world units/s. */
export const PACE_PROTO = {
  kind: 'A' as PaceKind,
  /** A fast typist (the user's measured Pace). Stars move fast here. */
  fast: 33,
  /** The Pace limit: stars move super fast here; faster Paces count as this. */
  limit: 66,
  /** Star speed at `fast` and at `limit` (old idle drift was 6). */
  starsAtFast: 20,
  starsAtLimit: 50,
  /** Pace gap (words / min) at which the ship reaches its smallest / biggest size. */
  maxGap: 16,
  /** Ship size when you're ahead by the max gap (smallest) and when the enemy is (biggest). Equal = 1. */
  minSize: 0.5,
  maxSize: 2,
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

/** Ship size for a lead in −1..1 (−1 = you way ahead, 0 = equal, 1 = enemy way ahead). */
function sizeFor(lead: number) {
  const { minSize, maxSize } = PACE_PROTO;
  return lead >= 0 ? 1 + (maxSize - 1) * lead : 1 + (1 - minSize) * lead;
}

export class PaceMotion {
  private speed = 0;
  /** Smoothed enemy lead, −1..1. */
  private lead = 0;

  constructor(private readonly enemy: EnemyShip) {}

  update(pace: { player: number; enemy: number }, dt: number) {
    const { limit, maxGap } = PACE_PROTO;
    const player = Math.min(pace.player, limit);
    const enemy = Math.min(pace.enemy, limit);
    const d = player - enemy;
    const mag = starSpeedFor(player);
    /** Enemy lead in −1..1: positive when the enemy types faster. */
    const leadRaw = Math.max(-1, Math.min(1, -d / maxGap));
    let target: number;
    let leadTarget: number;

    if (PACE_PROTO.kind === 'A') {
      target = (d >= 0 ? 1 : -1) * mag;
      this.speed += (target - this.speed) * follow(dt, 0.4);
      leadTarget = leadRaw;
      this.lead += (leadTarget - this.lead) * follow(dt, 0.4);
      this.enemy.effectScale = sizeFor(this.lead);
      this.enemy.approach = 1;
    } else if (PACE_PROTO.kind === 'B') {
      // Direction blends through 0: near-equal Paces (within ~5 words/min) ease the stars to a stop.
      target = Math.tanh(d / 5) * mag;
      this.speed += (target - this.speed) * follow(dt, 0.8);
      // Gaps under 3 words/min keep the ship at normal size.
      leadTarget = Math.sign(leadRaw) * smoothstep(3, maxGap, Math.abs(d));
      this.lead += (leadTarget - this.lead) * follow(dt, 1.5);
      this.enemy.effectScale = sizeFor(this.lead);
      this.enemy.approach = 1;
    } else {
      // Stars with inertia; the ship actually flies closer (bigger) / farther instead of scaling.
      target = Math.tanh(d / 3) * mag;
      this.speed += (target - this.speed) * follow(dt, 1.2);
      leadTarget = leadRaw;
      this.lead += (leadTarget - this.lead) * follow(dt, 1);
      this.enemy.effectScale = 1;
      this.enemy.approach = sizeFor(this.lead); // same size range, by distance
    }
    STAR_DRIFT.speed = this.speed;
  }
}
