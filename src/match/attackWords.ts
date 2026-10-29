import { TIERS, type Tier, type WordList } from '../words/wordLists';
import type { AttackWordSource } from './types';

/**
 * Seeded Attack words. At pairing the server issues each player a 32-bit seed, and both players know
 * both seeds. Player P's `i`-th Attack word is `pick(seedP, i, t, list)`, where `t` is the Match time the
 * word was picked (the moment the previous Attack word was fired; 0 for the first). The opponent
 * recomputes it with `ShotVerifier`, so a player can't fire easy words of their own choice.
 *
 * Both clients must compute exactly the same word, so this file:
 * - is stateless: the word depends only on (seed, i, t, list), never on what was asked before;
 * - uses only integer maths, `+ - * /` and `Math.floor` (exact, same in every JS engine), never
 *   `Math.pow / exp / log / sin`, whose last digits can differ between browsers;
 * - must be the same version and run over the same word list (`listVersion`) on both sides.
 */

/**
 * Bump on any change to the mixing, the choice rule or `DIFFICULTY`. The handshake should compare it
 * (with `listVersion`) so two clients on different builds don't flag each other as cheaters.
 */
export const ATTACK_PICKER_VERSION = 1;

export type TierWeights = Readonly<Record<Tier, number>>;

/**
 * The difficulty curve (tunable): the chance of each length tier for an Attack word, moving in a straight
 * line from `start` (Match time 0) to `end` (at `rampSeconds`), then staying there. Each side adds up to 1.
 * Short words are always possible; long ones are possible from the start.
 */
export const DIFFICULTY = {
  rampSeconds: 180,
  start: { short: 0.55, medium: 0.4, long: 0.05 },
  end: { short: 0.15, medium: 0.4, long: 0.45 },
} as const satisfies { rampSeconds: number; start: TierWeights; end: TierWeights };

/** How likely each tier is for a word picked at Match time `t` (seconds). */
export function difficulty(t: number): TierWeights {
  // To the millisecond: a `t` rounded when it crosses the wire picks the same word.
  const ms = Number.isFinite(t) ? Math.round(Math.max(0, t) * 1000) : 0;
  const f = Math.min(ms / (DIFFICULTY.rampSeconds * 1000), 1);
  const at = (tier: Tier) => DIFFICULTY.start[tier] + (DIFFICULTY.end[tier] - DIFFICULTY.start[tier]) * f;
  return { short: at('short'), medium: at('medium'), long: at('long') };
}

/** Mixes 32 bits well (lowbias32, Chris Wellons). */
function mix32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** A random 32-bit number for (seed, i, stream), the same on every run and in every browser. */
function draw(seed: number, i: number, stream: number): number {
  return mix32((mix32((mix32(seed >>> 0) + i) >>> 0) + stream) >>> 0);
}

const TWO_POW_32 = 4294967296;

/** The `i`-th Attack word of a seed, picked at Match time `t`. */
export function pick(seed: number, i: number, t: number, list: WordList): string {
  const w = difficulty(t);
  const u = draw(seed, i, 0) / TWO_POW_32; // 0 <= u < 1, exact
  const tier: Tier = u < w.short ? 'short' : u < w.short + w.medium ? 'medium' : 'long';
  const words = list[tier];
  // draw / 2^32 * length is exact (32-bit number times a number under 2^15), so the floor is too.
  return words[Math.floor((draw(seed, i, 1) / TWO_POW_32) * words.length)];
}

/** The Attack-word source the Match rules engine asks for words: one player's seed over the word list. */
export function createAttackWordSource(seed: number, list: WordList): AttackWordSource {
  for (const tier of TIERS) {
    if (list[tier].length === 0) throw new Error(`Word list has no ${tier} words`);
  }
  return { wordAt: (i, t) => pick(seed, i, t, list) };
}
