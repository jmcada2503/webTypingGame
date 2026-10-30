import { GLITCH, MATCH_START_HOLD, TV_OFF_ON, type TransitionEffect } from './ScreenTransition';

/** How an online Match ended. */
export type EndingResult = 'won' | 'lost' | 'peace';

/**
 * What the game scene shows `t` seconds after the Match result is known, as the approved endings
 * (Win: the Enemy ship is destroyed; Lose: the Enemy ship comes close and flies over the player; Peace: both ships go away).
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
  /** Camera rumble, 0..1 (Lose: the Enemy ship's engines as it comes over). */
  shake: number;
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
  lost: { sceneSeconds: 5.2, effect: TV_OFF_ON, hold: MATCH_START_HOLD },
  peace: { sceneSeconds: 4.6, effect: GLITCH, hold: 0 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const NEUTRAL: EndingFrame = { enemyVisible: true, enemyOffset: { x: 0, y: 0, z: 0 }, pace: null, paceScale: 1, dim: 0, shake: 0 };

/** Where the Peace ship ends up: up, aside and far off. */
const PEACE_FLY = { x: 30, y: 12, z: -70 };

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Lose: the stars slow to a stop, the Enemy ship drifts down and close and looms (the lights dim as it fills the
 * view), then rushes over the player: up and out of the top of the picture, and behind the camera.
 * Offsets are from its resting place (0, 7.5, -27); the camera is at z = 7 looking down -z.
 */
function loseFrame(t: number): Pick<EndingFrame, 'enemyVisible' | 'enemyOffset' | 'paceScale' | 'dim' | 'shake'> {
  const loom = smooth(clamp01((t - 0.8) / 2.4)); // the slow drift in
  const k = clamp01((t - 3.4) / 1.1); // the rush
  const y = -5.6 * loom + 4 * smooth(clamp01((k - 0.5) / 0.5));
  return {
    enemyVisible: k < 0.97, // behind the camera once it has passed
    enemyOffset: { x: 0, y: y + 0, z: loom * 26 + k * k * k * 22 },
    paceScale: 1 - clamp01((t - 0.3) / 1.2),
    dim: Math.min(0.9, loom * 0.55 + clamp01(1 - Math.abs(k - 0.8) / 0.2) * 0.35), // and a shadow as it passes
    shake: t < 0.8 ? 0 : 0.15 + loom * 0.25 + k * 0.6,
  };
}

export function endingFrame(result: EndingResult, t: number): EndingFrame {
  const frame: EndingFrame = { ...NEUTRAL, enemyOffset: { ...NEUTRAL.enemyOffset } };
  if (result === 'won') {
    frame.enemyVisible = t < 0.5;
  } else if (result === 'lost') {
    Object.assign(frame, loseFrame(t));
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

/**
 * Seconds after the result when the Rematch clock starts, the same for both players: when the loser's end screen
 * is up (the Win scene is shorter, so the winner waits). Peace ends for both at once.
 */
export function rematchClockStart(result: EndingResult): number {
  const plan = ENDINGS[result === 'peace' ? 'peace' : 'lost'];
  return plan.sceneSeconds + plan.effect.out;
}
