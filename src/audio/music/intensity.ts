import type { GameViewState } from '../../view/GameViewState';
/** What the music reads from the game each frame. */
export interface MusicInputs {
  mode: 'versus' | 'practice';
  lives: number;
  bullets: number;
  /** The Flight of the nearest Word bullet (0 when none). */
  maxFlight: number;
  pacePlayer: number;
  paceEnemy: number;
  /** 0..1 */
  enemyDamage: number;
  /** Seconds since the Match began. */
  matchTime: number;
}

/** -1 losing (darker harmony), 0 neutral, 1 winning (major). */
export type Mood = -1 | 0 | 1;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
/** The Pace lead past which the music turns major (or, behind by as much, darker). */
const MOOD_GAP = 0.8;

/** Threat: how close the nearest Word bullet is, how many fly, Lives lost. */
const danger = (i: MusicInputs) => clamp(0.12 + 0.55 * i.maxFlight ** 1.6 + 0.08 * Math.min(i.bullets, 4) + 0.12 * (3 - i.lives));

/** Pace: both typing fast, and a big gap, raise it; the gap sets the mood. Practice has no opponent: my own Pace. */
function duel(i: MusicInputs): { intensity: number; mood: Mood } {
  if (i.mode === 'practice') return { intensity: clamp(0.15 + 0.8 * (i.pacePlayer / 8)), mood: 0 };
  const gap = i.pacePlayer - i.paceEnemy;
  const energy = clamp((i.pacePlayer + i.paceEnemy) / 12);
  return { intensity: clamp(0.15 + 0.5 * energy + 0.35 * clamp(Math.abs(gap) / 4)), mood: gap > MOOD_GAP ? 1 : gap < -MOOD_GAP ? -1 : 0 };
}

/** Story: builds over the Match (2 min online, 5 min Practice), plus Lives lost and Enemy damage. */
const arc = (i: MusicInputs) => clamp(0.15 + 0.6 * clamp(i.matchTime / (i.mode === 'practice' ? 300 : 120)) + 0.1 * (3 - i.lives) + 0.1 * i.enemyDamage);

/**
 * How intense the Match music is right now (0..1), before smoothing: mostly Danger, some Pace (Duel) and Match
 * time (Arc), and a Danger spike always cuts through. The mood comes from the Pace gap.
 */
export function blendIntensity(i: MusicInputs): { intensity: number; mood: Mood } {
  const d = danger(i);
  const du = duel(i);
  return { intensity: clamp(Math.max(0.85 * d, 0.5 * d + 0.3 * du.intensity + 0.2 * arc(i))), mood: du.mood };
}

/** Seconds (time constants) the heard intensity takes to follow the game: quick to rise, slow to calm down. */
const RISE_SECONDS = 0.6;
const FALL_SECONDS = 3;

/** One frame (`dt` seconds) of the heard intensity following the raw one. */
export function smoothIntensity(current: number, raw: number, dt: number): number {
  return current + (raw - current) * (1 - Math.exp(-dt / (raw > current ? RISE_SECONDS : FALL_SECONDS)));
}

/** The music's inputs from the scene the player sees. */
export function musicInputsOf(view: GameViewState, mode: MusicInputs['mode'], matchTime: number): MusicInputs {
  return {
    mode,
    lives: view.lives,
    bullets: view.wordBullets.length,
    maxFlight: Math.max(0, ...view.wordBullets.map((b) => b.flight)),
    pacePlayer: view.pace.player,
    paceEnemy: view.pace.enemy,
    enemyDamage: view.enemyDamage,
    matchTime,
  };
}
