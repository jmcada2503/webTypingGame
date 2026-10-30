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
  /** PROTOTYPE: camera rumble 0..1 (Lose fly-over). */
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
  lost: { sceneSeconds: 3.8, effect: TV_OFF_ON, hold: MATCH_START_HOLD },
  peace: { sceneSeconds: 4.6, effect: GLITCH, hold: 0 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const NEUTRAL: EndingFrame = { enemyVisible: true, enemyOffset: { x: 0, y: 0, z: 0 }, pace: null, paceScale: 1, dim: 0, shake: 0 };

/** Where the Peace ship ends up: up, aside and far off. */
const PEACE_FLY = { x: 30, y: 12, z: -70 };

export function endingFrame(result: EndingResult, t: number): EndingFrame {
  const frame: EndingFrame = { ...NEUTRAL, enemyOffset: { ...NEUTRAL.enemyOffset } };
  if (result === 'won') {
    frame.enemyVisible = t < 0.5;
  } else if (result === 'lost') {
    flyover(frame, t);
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

// ---- PROTOTYPE: Lose fly-over variants (throwaway; switch with the bottom bar or ?lose=1|2|3) ----
export const LOSE_VARIANTS = [
  { name: '1 SWOOP', seconds: 4.4, desc: 'stars slow, ship charges in and passes overhead, shadow as it passes' },
  { name: '2 LOOM', seconds: 5.2, desc: 'ship drifts close and looms, holds, then rushes overhead' },
  { name: '3 DIVE', seconds: 3.6, desc: 'fast dive, stars keep flying, hard rumble, dark after the pass' },
];
export const proto = { lose: Number(new URLSearchParams(location.search).get('lose') ?? 1) || 1 };
export function setLoseVariant(n: number) {
  proto.lose = n;
  ENDINGS.lost.sceneSeconds = LOSE_VARIANTS[n - 1].seconds;
}
setLoseVariant(proto.lose);

const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Offsets are from the resting place (0, 7.5, -27); the camera is at z = 7 looking down -z. */
function flyover(f: EndingFrame, t: number) {
  const v = proto.lose;
  let k = 0; // 0..1 progress of the charge
  let y = 0;
  if (v === 1) {
    f.paceScale = 1 - clamp01((t - 0.3) / 1);
    k = clamp01((t - 1.2) / 2.2);
    const e = k * k;
    y = -5.3 * smooth(clamp01(k / 0.75)) + 3.8 * smooth(clamp01((k - 0.75) / 0.25));
    f.enemyOffset = { x: 0, y, z: e * 42 };
    const pass = clamp01(1 - Math.abs(k - 0.85) / 0.2); // shadow as it passes overhead
    f.dim = Math.min(0.9, clamp01((t - 0.5) * 0.4) * 0.5 + pass * 0.4 + (t > 3.4 ? 0.2 : 0));
    f.shake = k > 0 ? 0.3 + 0.7 * k : 0;
  } else if (v === 2) {
    f.paceScale = 1 - clamp01((t - 0.3) / 1.2);
    const a = clamp01((t - 0.8) / 2.4); // slow drift in, down to eye level
    const loom = smooth(a);
    k = clamp01((t - 3.4) / 1.1); // the rush
    const e = k * k * k;
    y = -5.6 * loom + 4 * smooth(clamp01((k - 0.5) / 0.5));
    f.enemyOffset = { x: 0, y, z: loom * 26 + e * 22 };
    f.dim = Math.min(0.9, loom * 0.55 + clamp01(1 - Math.abs(k - 0.8) / 0.2) * 0.35);
    f.shake = t < 0.8 ? 0 : 0.15 + loom * 0.25 + k * 0.6;
  } else {
    f.paceScale = 1;
    k = clamp01((t - 0.5) / 1.1);
    const e = k * k;
    y = -5.2 * smooth(clamp01(k / 0.7)) + 3.5 * smooth(clamp01((k - 0.7) / 0.3));
    f.enemyOffset = { x: 0, y, z: e * 42 };
    f.shake = k > 0 && k < 1.2 ? 0.5 + k * 0.5 : 0;
    f.dim = t > 1.6 ? Math.min(0.9, (t - 1.6) * 1.2) : clamp01(1 - Math.abs(k - 0.85) / 0.15) * 0.5;
    if (t > 1.7) f.paceScale = clamp01(1 - (t - 1.7) / 0.3);
  }
  f.enemyVisible = k < 0.97; // behind the camera once it has passed
}
