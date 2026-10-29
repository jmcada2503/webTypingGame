import { GLITCH, MATCH_START_HOLD, TV_OFF_ON, type TransitionEffect } from './ScreenTransition';

/** How an online Match ended. */
export type EndingResult = 'won' | 'lost' | 'peace';

/**
 * What the game scene shows `t` seconds after the Match result is known, as the approved endings
 * (Win: the Enemy ship is destroyed; Lose: the cockpit powers down; Peace: both ships go away).
 * Declarative: the host applies it to the view every frame.
 */
export interface EndingFrame {
  enemyVisible: boolean;
  /** Offset of the Enemy ship from its resting place, in world units (Peace: it flies away). */
  enemyOffset: { x: number; y: number; z: number };
  /** Pace to show (how fast the stars fly), or null to leave the real one (Peace: the stars race). */
  pace: number | null;
  /** Multiplier on the real Pace, 1 = as is (Lose: the stars slow to a stop). */
  paceScale: number;
  /** How dark the picture is, 0..1 (Lose: the lights dim). */
  dim: number;
}

/** One-off moments the view plays. */
export type EndingMoment = 'enemyDestroyed';

export interface EndingPlan {
  /** Seconds the scene plays before the screen changes. */
  sceneSeconds: number;
  /** The screen-change effect into the end screen, and the black hold between its off and on. */
  effect: TransitionEffect;
  hold: number;
}

export const ENDINGS: Record<EndingResult, EndingPlan> = {
  won: { sceneSeconds: 1.6, effect: GLITCH, hold: 0 },
  lost: { sceneSeconds: 3.8, effect: TV_OFF_ON, hold: MATCH_START_HOLD },
  peace: { sceneSeconds: 4.6, effect: GLITCH, hold: 0 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const NEUTRAL: EndingFrame = { enemyVisible: true, enemyOffset: { x: 0, y: 0, z: 0 }, pace: null, paceScale: 1, dim: 0 };

/** Where the Peace ship ends up: up, aside and far off. */
const PEACE_FLY = { x: 30, y: 12, z: -70 };

export function endingFrame(result: EndingResult, t: number): EndingFrame {
  const frame: EndingFrame = { ...NEUTRAL, enemyOffset: { ...NEUTRAL.enemyOffset } };
  if (result === 'won') {
    frame.enemyVisible = t < 0.5;
  } else if (result === 'lost') {
    frame.paceScale = 1 - clamp01((t - 0.4) / 1);
    frame.dim = Math.min(0.85, Math.max(0, (t - 0.6) * 0.45));
  } else {
    if (t >= 0.8) frame.pace = Math.min(9, 2 + (t - 0.8) * 3);
    const k = clamp01((t - 0.8) / 3);
    const e = k * k;
    frame.enemyOffset = { x: e * PEACE_FLY.x + 0, y: e * PEACE_FLY.y + 0, z: e * PEACE_FLY.z + 0 }; // + 0 turns -0 into 0
  }
  return frame;
}

/** The one-off moments that fall in the time span (from, to]. */
export function endingMoments(result: EndingResult, from: number, to: number): EndingMoment[] {
  const at: { t: number; moment: EndingMoment }[] = result === 'won' ? [{ t: 0.05, moment: 'enemyDestroyed' }] : [];
  return at.filter((m) => m.t > from && m.t <= to).map((m) => m.moment);
}
