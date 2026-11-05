import { describe, expect, test } from 'vitest';
import { blendIntensity, smoothIntensity, type MusicInputs } from './intensity';

/** A Match just started: 3 Lives, nothing flying, nobody typing. */
const CALM: MusicInputs = { mode: 'versus', lives: 3, bullets: 0, maxFlight: 0, pacePlayer: 0, paceEnemy: 0, enemyDamage: 0, matchTime: 0 };

// Worked by hand from the Blend rule (Adaptive music prototype):
// Danger = 0.12 + 0.55 × Flight^1.6 + 0.08 × min(bullets, 4) + 0.12 × Lives lost
// Duel   = 0.15 + 0.5 × clamp((mine + theirs) / 12) + 0.35 × clamp(|gap| / 4)   (Practice: 0.15 + 0.8 × mine / 8)
// Arc    = 0.15 + 0.6 × clamp(time / 120 s, Practice 300 s) + 0.1 × Lives lost + 0.1 × Enemy damage
// Blend  = max(0.85 × Danger, 0.5 × Danger + 0.3 × Duel + 0.2 × Arc)
describe('music intensity (Blend)', () => {
  test('a calm start is low: 0.5 × 0.12 + 0.3 × 0.15 + 0.2 × 0.15 = 0.135', () => {
    expect(blendIntensity(CALM).intensity).toBeCloseTo(0.135, 6);
  });

  test('danger cuts through: a Word bullet about to hit, 4 flying, on the last Life gives 0.85', () => {
    expect(blendIntensity({ ...CALM, maxFlight: 1, bullets: 4, lives: 1 }).intensity).toBeCloseTo(0.85, 6);
  });

  test('a fast duel a minute in: Pace 6 vs 2 gives 0.4, and the winning mood', () => {
    // Duel = 0.15 + 0.5 × 8/12 + 0.35 × 1 = 0.8333; Arc = 0.15 + 0.6 × 0.5 = 0.45; 0.06 + 0.25 + 0.09 = 0.4
    expect(blendIntensity({ ...CALM, pacePlayer: 6, paceEnemy: 2, matchTime: 60 })).toEqual({ intensity: expect.closeTo(0.4, 6), mood: 1 });
  });

  test('the mood follows the Pace gap: behind by more than 0.8 is losing, within it neutral', () => {
    expect(blendIntensity({ ...CALM, pacePlayer: 1, paceEnemy: 3 }).mood).toBe(-1);
    expect(blendIntensity({ ...CALM, pacePlayer: 3, paceEnemy: 2.5 }).mood).toBe(0);
  });

  test('Practice reads my own Pace, over a 5-minute arc, always neutral', () => {
    // Duel = 0.15 + 0.8 × 4/8 = 0.55; Arc = 0.15 + 0.6 × 150/300 = 0.45; 0.06 + 0.165 + 0.09 = 0.315
    expect(blendIntensity({ ...CALM, mode: 'practice', pacePlayer: 4, paceEnemy: 9, matchTime: 150 })).toEqual({ intensity: expect.closeTo(0.315, 6), mood: 0 });
  });
});

describe('smoothing', () => {
  /** Follow `target` from `from` for `seconds`, a frame at a time. */
  const follow = (from: number, target: number, seconds: number) => {
    let v = from;
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) v = smoothIntensity(v, target, 1 / 60);
    return v;
  };

  test('rises fast: 63% of the way in 0.6 s', () => {
    expect(follow(0, 1, 0.6)).toBeCloseTo(1 - Math.exp(-1), 3);
  });

  test('falls slowly: still 37% of the way up after 3 s', () => {
    expect(follow(1, 0, 3)).toBeCloseTo(Math.exp(-1), 3);
  });
});
