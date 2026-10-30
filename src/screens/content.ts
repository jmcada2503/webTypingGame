import type { MatchStats } from '../match/MatchEngine';
import type { Language, MatchKind } from '../flow/types';
import { PRACTICE_RAMP } from '../practice/PracticeDirector';
import type { PracticeResult } from '../practice/PracticeSession';
import type { PaletteColor } from '../render/AsciiRenderer';
import { formatClock } from './draw';

/** Placeholder until the real GitHub Sponsors page exists (the prototype used the repo owner's login). */
export const SPONSOR_LINK = 'https://github.com/sponsors/jmcada2503';
/** Placeholder game name. */
export const GAME_NAME: [string, string] = ['TYPING ', 'GAME'];

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Placeholder online counts: stale on purpose, they only change every 30 s. Replaced by the presence endpoint later. */
/** Players online now: everyone, and per language. */
export type OnlineCounts = { en: number; es: number; total: number };

/** Made-up counts for screens shown without the real network (`?fake`, the sandbox). */
export function placeholderOnline(seconds: number): OnlineCounts {
  const step = Math.floor(seconds / 30);
  const en = 97 + Math.round((hash(step) - 0.5) * 8);
  const es = 31 + Math.round((hash(step + 9) - 0.5) * 4);
  return { en, es, total: en + es };
}

export const MENU_ITEMS = [
  { key: 'practice', label: 'PRACTICE', desc: 'PLAY ALONE. WORDS KEEP COMING UNTIL YOU RUN OUT OF LIVES.', online: false },
  { key: 'public', label: 'PUBLIC MATCH', desc: 'FACE A RANDOM OPPONENT ONLINE.', online: true },
  { key: 'private', label: 'PRIVATE MATCH', desc: 'PLAY A FRIEND. YOU GET AN INVITE LINK TO SHARE.', online: true },
] as const;

/** The next menu card in direction `d`, wrapping around and skipping the online cards while servers rest. */
export function moveSelection(sel: number, d: 1 | -1, resting: boolean): number {
  const n = MENU_ITEMS.length;
  for (let k = 1; k <= n; k++) {
    const i = (sel + d * k + n * 4) % n;
    if (!(resting && MENU_ITEMS[i].online)) return i;
  }
  return sel;
}

/** The card that should be highlighted: an online card that became unavailable (servers resting) falls back to Practice. */
export function usableSelection(sel: number, resting: boolean): number {
  return resting && MENU_ITEMS[sel].online ? 0 : sel;
}

/** One line of the waiting screen's channel log: label, status, status color. Endless: it keeps scanning. */
export function waitingLogLine(i: number, kind: MatchKind, language: Language): [string, string, PaletteColor] {
  const lang = language === 'en' ? 'ENGLISH' : 'SPANISH';
  const base: [string, string, PaletteColor][] =
    kind === 'private'
      ? [
          ['OPENING CHANNEL', 'OK', 'green'],
          ['LANGUAGE', lang, 'fg'],
          ['CREATING PRIVATE MATCH', 'OK', 'green'],
          ['INVITE LINK', 'READY', 'green'],
          ['WAITING FOR GUEST', 'NO ONE YET', 'yellow'],
        ]
      : [
          ['OPENING CHANNEL', 'OK', 'green'],
          ['LANGUAGE', lang, 'fg'],
          ['ENTERING QUEUE', 'OK', 'green'],
          ['SCANNING SECTOR 07', 'NO CONTACT', 'yellow'],
        ];
  if (i < base.length) return base[i];
  const k = i - base.length;
  const label = kind === 'private' ? `PINGING GUEST SLOT ${k + 1}` : `SCANNING SECTOR ${String(7 + (((k + 1) * 5) % 40)).padStart(2, '0')}`;
  return [label, 'NO CONTACT', 'yellow'];
}

export const TIPS = [
  "TYPE A WORD BULLET'S WORD TO DESTROY IT BEFORE IT HITS YOU",
  'TYPE YOUR ATTACK WORD AND PRESS ENTER TO FIRE AT YOUR OPPONENT',
  'DEFENDING COMES FIRST: A MATCHING WORD BULLET IS DESTROYED BEFORE YOUR ATTACK FIRES',
  'YOU HAVE 3 LIVES. EVERY WORD BULLET THAT REACHES YOU COSTS ONE',
  'IF BOTH PLAYERS STAY IDLE FOR 10 SECONDS, THE MATCH ENDS IN PEACE',
];
const TIP_SECONDS = 6;
const TIP_LETTERS_PER_SECOND = 22;

/** The tip being typed out at `t` seconds: each tip shows for 6 s, then the next. */
export function typedTip(t: number): string {
  return TIPS[Math.floor(t / TIP_SECONDS) % TIPS.length].slice(0, Math.floor((t % TIP_SECONDS) * TIP_LETTERS_PER_SECOND));
}

/** What the Countdown shows with `secondsLeft` to go: the number, how far into its second (0..1), size and color. */
export function countdownDisplay(secondsLeft: number) {
  const n = Math.max(1, Math.ceil(secondsLeft));
  const frac = Math.min(1, Math.max(0, n - secondsLeft));
  return {
    n,
    frac,
    /** Each number shrinks a little as its second runs out. */
    scale: 13 - 2 * frac,
    /** A color-split pulse in the first moments of each second. */
    pulse: frac < 0.14,
    color: n <= 2 ? ('red' as const) : ('yellow' as const),
  };
}

/** The GO flash after the Match begins: `t` seconds in, it blinks 8 times a second for just under a second. */
export const GO_SECONDS = 0.9;
export function goFlash(t: number): boolean {
  return t >= 0 && t < GO_SECONDS && Math.floor(t * 8) % 2 === 0;
}

/** Points for each second of the difficulty ramp a run reached. */
const POINTS_PER_LEVEL_SECOND = 10;

/**
 * The Practice score: the difficulty level the run reached (a second of the ramp, 0 to its top), times 10.
 * 0 if the run never got past the speed measurement. It stops at the top of the ramp, where difficulty stops rising.
 */
export function practiceScore(r: Pick<PracticeResult, 'currentLevel'>): number {
  if (r.currentLevel === null) return 0;
  return Math.round(Math.min(r.currentLevel, PRACTICE_RAMP.rampSeconds) * POINTS_PER_LEVEL_SECOND);
}

/** How far up the difficulty ramp the run got, 0..1 (capped at the top); null if it was never placed on the ramp. */
export function practiceDifficulty(r: Pick<PracticeResult, 'currentLevel'>): number | null {
  if (r.currentLevel === null) return null;
  return Math.min(r.currentLevel, PRACTICE_RAMP.rampSeconds) / PRACTICE_RAMP.rampSeconds;
}

/** One encouraging word for the Practice game over, by the difficulty reached (Practice is about getting better). */
export function practiceVerdict(difficulty: number | null): string {
  const d = difficulty ?? 0;
  if (d < 0.2) return 'WARMING UP';
  if (d < 0.4) return 'STEADY HANDS';
  if (d < 0.6) return 'QUICK FINGERS';
  if (d < 0.8) return 'ACE TYPIST';
  return 'UNSTOPPABLE';
}

/** The Practice game over's 3×2 stat grid as label / value cells, read row by row. */
export function practiceStatCells(r: Pick<PracticeResult, 'survivedSeconds' | 'wordsTyped' | 'accuracy' | 'peakPace' | 'wpm' | 'currentLevel'>): [string, string][] {
  const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
  return [
    ['TIME', formatClock(r.survivedSeconds)],
    ['DIFFICULTY', pct(practiceDifficulty(r))],
    ['WORDS', String(r.wordsTyped)],
    ['WPM', String(Math.round(r.wpm))],
    ['ACCURACY', pct(r.accuracy)],
    ['BEST PACE', `${r.peakPace.toFixed(1)} L/S`],
  ];
}

/** Seconds the Practice score takes to count up on the game over screen. */
export const SCORE_COUNT_SECONDS = 1.2;

/** The score shown `t` seconds into the game over screen: it counts up from 0. */
export function countingScore(score: number, t: number): number {
  return Math.round(score * Math.min(1, Math.max(0, t / SCORE_COUNT_SECONDS)));
}

const PRACTICE_BEST_KEY = 'practice.best';

/**
 * Check a finished run against the best score of this browser session (sessionStorage until there are accounts)
 * and save it if it beats it. The best is read before saving, so `bestBefore` is the one this run was up against.
 * A score of 0 is never a best. Storage that is missing or throws (private mode, full) just means no best.
 */
export function settlePracticeBest(score: number, storage: () => Pick<Storage, 'getItem' | 'setItem'>): { bestBefore: number | null; newBest: boolean } {
  try {
    const store = storage();
    const stored = Number(store.getItem(PRACTICE_BEST_KEY) ?? NaN);
    const bestBefore = Number.isFinite(stored) ? stored : null;
    const newBest = score > 0 && (bestBefore === null || score > bestBefore);
    if (newBest) store.setItem(PRACTICE_BEST_KEY, String(score));
    return { bestBefore, newBest };
  } catch {
    return { bestBefore: null, newBest: false };
  }
}

/** The stats block of the online end screens. `enemyDamage` (0..1) is added on a Lose. */
export function matchStatsLines(m: MatchStats, enemyDamage: number | null = null): string[] {
  const pad = (label: string) => label.padEnd(18);
  const pace = m.elapsed > 0 ? m.correctLetters / m.elapsed : 0;
  const answered = m.correctWords + m.wrongSubmits;
  const lines = [
    `${pad('TIME')}${formatClock(m.elapsed)}`,
    `${pad('PACE')}${pace.toFixed(1)} LETTERS/S (${Math.round((pace * 60) / 5)} WPM)`,
    `${pad('ACCURACY')}${answered === 0 ? '-' : `${Math.round((m.correctWords / answered) * 100)}%`}`,
    `${pad('WORDS DESTROYED')}${m.bulletsDestroyed}`,
    `${pad('SHOTS HIT')}${m.shotsHit} OF ${m.shotsFired}`,
  ];
  if (enemyDamage !== null) lines.push(`${pad('ENEMY DAMAGE')}${Math.round(enemyDamage * 100)}%`);
  return lines;
}

export const DEMO_DEFEND_WORD = 'planet';
export const DEMO_ATTACK_WORD = 'rocket';

/** The how-to's looping 10 s demo: what is on screen `t` seconds in. */
export function howToDemo(t: number) {
  const tt = t % 10;
  return {
    bulletOn: tt < 4.6,
    flight: Math.min(0.85, tt / 5.4),
    defTyped: tt < 2.5 || tt >= 4.6 ? 0 : Math.min(6, Math.floor((tt - 2.5) / 0.3) + 1),
    boom: tt >= 4.6 && tt < 5.4 ? (tt - 4.6) / 0.8 : -1,
    atkTyped: tt < 5.6 || tt >= 7.4 ? 0 : Math.min(6, Math.floor((tt - 5.6) / 0.3) + 1),
    shotOn: tt >= 7.4 && tt < 9.2,
    shotFlight: (tt - 7.4) / 1.8,
    hit: tt >= 9.2 ? (tt - 9.2) / 0.8 : -1,
  };
}
