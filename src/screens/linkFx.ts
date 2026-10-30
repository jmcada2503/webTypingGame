import { DEFAULT_FLOW_CONFIG, MAX_SIGNAL_LOSSES, RESUME_COUNT_SECONDS } from '../flow/types';

/**
 * What the game scene shows while the opponent's signal is lost (`away`) or just back (`back`), as the approved
 * Disconnect design: the "signal breakup" animation, then the back-countdown. The host tells the view which one
 * and how far along it is; the frames below say what to draw. Pure timelines, like `endings.ts`.
 */
export type LinkFx = { kind: 'away'; t: number; secondsLeft: number; losses: number } | { kind: 'back'; secondsLeft: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** A repeatable pseudo-random number in 0..1 for a whole number (the same every run, so a flicker is a timeline too). */
export const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The lead-in: a glitch burst, WEAK SIGNAL, the held words flicker out, the ship's rows jump and settle. */
const BURST_SECONDS = 0.5;
const BURST_LEVEL = 0.55;
const WEAK_SIGNAL_UNTIL = 0.45;
const WORDS_GONE_AT = 0.8;
const BAR_AT = 0.7;
const NOTE_AT = 1.1;
const LEAD_IN = 1;

export interface AwayFrame {
  /** Strength (0..1) of the screen glitch burst when the signal drops. */
  glitch: number;
  /** The opponent's held Word bullets: they flicker out, then stay hidden (shown, they would cover the text). */
  wordsVisible: boolean;
  /** The Enemy ship flickers more and more, and is gone near the end of the grace. */
  enemyVisible: boolean;
  /** The static over the ship: how much of it, how often rows jump sideways, and how far. */
  staticDensity: number;
  slipChance: number;
  slipAmp: number;
  header: { text: 'WEAK SIGNAL' | 'ENEMY SIGNAL LOST' };
  /** The RECONNECTING bar: how much grace is left, and the seconds. */
  reconnecting: { fraction: number; seconds: number } | null;
  /** THEIR WORD BULLETS ARE HELD IN FLIGHT. NOTHING CAN HIT YOU. */
  heldNote: boolean;
  /** `SIGNAL LOSS n OF 3`, warning from the 2nd that one more ends the Match. */
  lossLine: { text: string; warn: boolean };
}

export function awayFrame(t: number, link: { secondsLeft: number; losses: number }): AwayFrame {
  const grace = DEFAULT_FLOW_CONFIG.disconnectGraceSeconds;
  const k = clamp01(1 - link.secondsLeft / grace); // how far through the grace
  const intro = clamp01(t / LEAD_IN);
  const warn = link.losses >= MAX_SIGNAL_LOSSES - 1;
  return {
    glitch: t < BURST_SECONDS ? BURST_LEVEL * (1 - t / BURST_SECONDS) ** 2 : 0,
    wordsVisible: t < WORDS_GONE_AT && hash(Math.floor(t * 22)) < 1 - t / WORDS_GONE_AT,
    enemyVisible: hash(Math.floor(t * 14)) > k * 0.55 && link.secondsLeft >= 0.2,
    staticDensity: 0.02 + 0.55 * k ** 1.3,
    slipChance: 0.07 + 0.4 * (1 - intro) ** 2,
    slipAmp: 10 + 14 * (1 - intro),
    header: { text: t < WEAK_SIGNAL_UNTIL ? 'WEAK SIGNAL' : 'ENEMY SIGNAL LOST' },
    reconnecting: t > BAR_AT ? { fraction: clamp01(link.secondsLeft / grace), seconds: link.secondsLeft } : null,
    heldNote: t > NOTE_AT,
    lossLine: {
      text: warn ? `SIGNAL LOSS ${link.losses} OF ${MAX_SIGNAL_LOSSES}: ONE MORE AND THE OPPONENT IS CONSIDERED GONE` : `SIGNAL LOSS ${link.losses} OF ${MAX_SIGNAL_LOSSES}`,
      warn,
    },
  };
}

export interface BackFrame {
  label: 'ENEMY BACK';
  /** The big digit, 5 to 1; null during the first beat. */
  digit: number | null;
  /** The last 2 seconds: the digit is red. */
  urgent: boolean;
  /** How far into the current second (0..1), for the pulse of the digit. */
  fraction: number;
  /** Their held Word bullets are on screen again, so the player sees where they stand. */
  wordsVisible: true;
}

/** The back-countdown: a short beat (their words reappear), then the digits, ending when the Match resumes. */
export function backFrame(secondsLeft: number): BackFrame {
  const beat = secondsLeft > RESUME_COUNT_SECONDS;
  const elapsed = RESUME_COUNT_SECONDS - secondsLeft; // into the digits
  const digit = beat ? null : Math.max(1, Math.ceil(secondsLeft));
  return {
    label: 'ENEMY BACK',
    digit,
    urgent: digit !== null && digit <= 2,
    fraction: beat ? 0 : ((elapsed % 1) + 1) % 1,
    wordsVisible: true,
  };
}
