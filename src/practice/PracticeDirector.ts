import { TIERS, type Tier, type WordList } from '../words/wordLists';

/**
 * How Practice gets harder. Everything moves in a straight line from `start` (0 s) to `end` (at
 * `rampSeconds`) and then stays: words come faster, fly faster and get longer. Tunable by playing.
 */
export const PRACTICE_RAMP = {
  /** Seconds before the first Word bullet. */
  firstSpawnAt: 1.5,
  rampSeconds: 420,
  start: { spawnEvery: 4, flightSeconds: 10, weights: { short: 0.7, medium: 0.28, long: 0.02 } },
  end: { spawnEvery: 1, flightSeconds: 5.5, weights: { short: 0.1, medium: 0.4, long: 0.5 } },
  /** The gap to the next word varies by up to this share either way, so it isn't a metronome. */
  jitter: 0.2,
} as const;

export interface RampStep {
  /** Average seconds between Word bullets. */
  spawnEvery: number;
  /** Seconds a Word bullet takes to reach the Cockpit. */
  flightSeconds: number;
  /** Chance of each length tier. */
  weights: Readonly<Record<Tier, number>>;
}

/** The difficulty at Match time `t` (seconds). */
export function rampAt(t: number): RampStep {
  const f = Math.min(Math.max(t / PRACTICE_RAMP.rampSeconds, 0), 1);
  const { start, end } = PRACTICE_RAMP;
  const mix = (a: number, b: number) => a + (b - a) * f;
  return {
    spawnEvery: mix(start.spawnEvery, end.spawnEvery),
    flightSeconds: mix(start.flightSeconds, end.flightSeconds),
    weights: {
      short: mix(start.weights.short, end.weights.short),
      medium: mix(start.weights.medium, end.weights.medium),
      long: mix(start.weights.long, end.weights.long),
    },
  };
}

/** One Word bullet for the game to fire at the player. */
export interface Spawn {
  word: string;
  flightSeconds: number;
}

export interface PracticeDirectorOptions {
  list: WordList;
  /** Returns a number in [0, 1). Default `Math.random`; tests pass a fixed one. */
  random?: () => number;
}

/**
 * Decides when Practice fires a Word bullet and which word. No seeds and no network: plain local
 * randomness over the word list. Time moves only through `advance(dt)`.
 */
export class PracticeDirector {
  private readonly list: WordList;
  private readonly random: () => number;
  private elapsed = 0;
  private nextAt: number = PRACTICE_RAMP.firstSpawnAt;

  constructor(options: PracticeDirectorOptions) {
    for (const tier of TIERS) {
      if (options.list[tier].length === 0) throw new Error(`Word list has no ${tier} words`);
    }
    this.list = options.list;
    this.random = options.random ?? Math.random;
  }

  /** Moves time on by `dt` seconds. `inFlight` = the words of the Word bullets on screen (not repeated). */
  advance(dt: number, inFlight: readonly string[]): Spawn[] {
    if (!(dt > 0)) return [];
    this.elapsed += dt;
    const taken = new Set(inFlight);
    const out: Spawn[] = [];
    while (this.nextAt <= this.elapsed) {
      const step = rampAt(this.nextAt); // the difficulty at the moment the word was due
      const word = this.pickWord(step.weights, taken);
      taken.add(word);
      out.push({ word, flightSeconds: step.flightSeconds });
      const jitter = 1 + (this.random() * 2 - 1) * PRACTICE_RAMP.jitter;
      this.nextAt += step.spawnEvery * jitter;
    }
    return out;
  }

  private draw(weights: RampStep['weights']): string {
    const u = this.random();
    const tier: Tier = u < weights.short ? 'short' : u < weights.short + weights.medium ? 'medium' : 'long';
    const words = this.list[tier];
    return words[Math.floor(this.random() * words.length)];
  }

  /** A word that isn't on screen already. Falls back to any free word, then to a repeat on a tiny list. */
  private pickWord(weights: RampStep['weights'], taken: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 8; attempt++) {
      const word = this.draw(weights);
      if (!taken.has(word)) return word;
    }
    for (const tier of TIERS) {
      const free = this.list[tier].find((w) => !taken.has(w));
      if (free) return free;
    }
    return this.draw(weights);
  }
}
