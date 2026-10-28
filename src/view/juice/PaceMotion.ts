import type { EnemyShip } from '../enemy/EnemyShip';
import { STAR_DRIFT } from '../enemy/StarDrift';

/**
 * Live-tunable from the sandbox panel. Paces in letters of correct words per second (see Pace in
 * CONTEXT.md), star speeds in world units / s. Calibrated on the user's own Pace test.
 */
export const PACE_LOOK = {
  /** A fast typist: stars move fast here. */
  fast: 4,
  /** The Pace limit: stars move super fast here; faster Paces count as this. */
  limit: 8,
  /** Star speed at `fast` and at `limit`. */
  starsAtFast: 20,
  starsAtLimit: 50,
  /** Pace lead (chars/s) at which the ship reaches its smallest / biggest size. */
  maxGap: 2,
  /** Ship size (× its normal look) when you're way ahead, at equal Paces, and when the enemy is way ahead. */
  minSize: 0.5,
  equalSize: 1.5,
  maxSize: 2,
};

/** How quickly the stars and the ship follow a Pace change (s). */
const EASE_SECONDS = 0.4;

/** How fast the stars fly for a player Pace: 0 → still, fast → fast, limit → super fast (capped). */
export function starSpeedFor(pace: number) {
  const { fast, limit, starsAtFast, starsAtLimit } = PACE_LOOK;
  const p = Math.min(Math.max(pace, 0), limit);
  if (p <= fast) return (starsAtFast * p) / fast;
  return starsAtFast + ((starsAtLimit - starsAtFast) * (p - fast)) / (limit - fast);
}

/** Ship size for an enemy lead in −1..1 (−1 = you way ahead, 0 = equal, 1 = enemy way ahead). */
function sizeFor(lead: number) {
  const { minSize, equalSize, maxSize } = PACE_LOOK;
  return lead >= 0 ? equalSize + (maxSize - equalSize) * lead : equalSize + (equalSize - minSize) * lead;
}

/**
 * Pace-driven motion ("Juice: Pace-driven motion"):
 * - **stars:** speed follows the player's Pace (still → fast at `fast` → super fast at `limit`);
 *   they fly toward the Cockpit while the player is ahead and away from it while the enemy is
 *   (a quick flip when the lead changes);
 * - **Enemy ship:** bigger while the enemy is ahead, smaller while the player is, `equalSize` at
 *   equal Paces; the lead sets how much.
 * The player's "moving stars" setting (STAR_DRIFT.motion) still freezes the stars.
 */
export class PaceMotion {
  private speed = 0;
  /** Smoothed enemy lead, −1..1. */
  private lead = 0;

  constructor(private readonly enemy: EnemyShip) {}

  update(pace: { player: number; enemy: number }, dt: number) {
    const { limit, maxGap } = PACE_LOOK;
    const d = Math.min(pace.player, limit) - Math.min(pace.enemy, limit);
    const k = 1 - Math.exp(-dt / EASE_SECONDS);
    const target = (d >= 0 ? 1 : -1) * starSpeedFor(pace.player);
    this.speed += (target - this.speed) * k;
    const lead = Math.max(-1, Math.min(1, -d / maxGap));
    this.lead += (lead - this.lead) * k;
    this.enemy.effectScale = sizeFor(this.lead);
    STAR_DRIFT.speed = this.speed;
  }
}
