import { TIERS, type Tier, type WordList } from '../words/wordLists';

/**
 * How Practice gets harder. Everything moves in a straight line from `start` (0 s) to `end` (at
 * `rampSeconds`) and then stays: words come faster, fly faster and get longer. Tunable by playing.
 */
export const PRACTICE_RAMP = {
  /** Seconds before the first Word bullet, and before the first one after the player is placed. */
  firstSpawnAt: 1.5,
  rampSeconds: 420,
  start: { spawnEvery: 4, flightSeconds: 10, weights: { short: 0.7, medium: 0.28, long: 0.02 } },
  end: { spawnEvery: 1, flightSeconds: 5.5, weights: { short: 0.1, medium: 0.4, long: 0.5 } },
  /** The gap to the next word varies by up to this share either way, so it isn't a metronome. */
  jitter: 0.2,
} as const;

/**
 * The first words of a run: a fixed mix (not the ramp) used to measure how fast the player types. They are
 * self-paced: one word at a time, and the next comes `gap` seconds after the screen is cleared (typed, or
 * arrived), so a slow typist never has words piling up. After `words` of them have been typed or missed, the
 * run is moved on to the player's level.
 */
export const PRACTICE_CALIBRATION = {
  words: 3,
  /** Seconds of empty screen before the next calibration word (the first one waits `PRACTICE_RAMP.firstSpawnAt`). */
  gap: 0.8,
  flightSeconds: 10,
  weights: { short: 0.3, medium: 0.5, long: 0.2 },
} as const;

/** Where the player is placed on the ramp. */
export const PRACTICE_PLACEMENT = {
  /** The level starts out asking this share of the player's measured Pace (they then climb from there). */
  share: 0.8,
  /** The measured Pace never divides by less than this many seconds of words on screen. */
  minActiveSeconds: 3,
} as const;

/** After placement, the ramp climbs faster while the player has nothing to type, so it never gets boring. */
export const PRACTICE_ACCELERATION = {
  /** Seconds of ramp that pass per real second while no Word bullet is on screen (1 = no speed-up). */
  emptyScreenRate: 3,
} as const;

export interface RampStep {
  /** Average seconds between Word bullets. */
  spawnEvery: number;
  /** Seconds a Word bullet takes to reach the Cockpit. */
  flightSeconds: number;
  /** Chance of each length tier. */
  weights: Readonly<Record<Tier, number>>;
}

/** The difficulty at ramp time `t` (seconds). */
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

export type MeanLengths = Readonly<Record<Tier, number>>;

/** The average number of letters of the words of each tier. */
export function meanLengths(list: WordList): MeanLengths {
  const mean = (words: readonly string[]) => words.reduce((sum, w) => sum + [...w].length, 0) / words.length;
  return { short: mean(list.short), medium: mean(list.medium), long: mean(list.long) };
}

/** How many letters per second the ramp asks the player to type at ramp time `t`. Goes up with `t`. */
export function demandAt(t: number, lengths: MeanLengths): number {
  const step = rampAt(t);
  const lettersPerWord = TIERS.reduce((sum, tier) => sum + step.weights[tier] * lengths[tier], 0);
  return lettersPerWord / step.spawnEvery;
}

/**
 * The ramp time to start a player at, from their measured Pace (letters per second): the first second
 * of the ramp that asks for `PRACTICE_PLACEMENT.share` of it. 0 for a slow player, the end of the ramp
 * for a very fast one.
 */
export function startLevelFor(pace: number, list: WordList): number {
  const target = (Number.isFinite(pace) && pace > 0 ? pace : 0) * PRACTICE_PLACEMENT.share;
  const lengths = meanLengths(list);
  for (let t = 0; t < PRACTICE_RAMP.rampSeconds; t++) {
    if (demandAt(t, lengths) >= target) return t;
  }
  return PRACTICE_RAMP.rampSeconds;
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

/** `calibrating`: measuring how fast the player types. `ramp`: playing at the player's level, getting harder. */
export type DirectorPhase = 'calibrating' | 'ramp';

/**
 * Decides when Practice fires a Word bullet and which word. No seeds and no network: plain local
 * randomness over the word list. Time moves only through `advance(dt)`.
 *
 * A run starts `calibrating`: one word at a time, each a `PRACTICE_CALIBRATION.gap` after the screen was
 * cleared. The caller measures the player and calls `finishCalibration(pace)`: the ramp clock jumps ahead to
 * the player's level and keeps rising from there, one second per second, or
 * `PRACTICE_ACCELERATION.emptyScreenRate` seconds per second while the screen is empty.
 */
export class PracticeDirector {
  phase: DirectorPhase = 'calibrating';
  /** The ramp time the player was placed at; `null` while calibrating. */
  startLevel: number | null = null;
  private readonly list: WordList;
  private readonly random: () => number;
  private elapsed = 0;
  /** Calibration: seconds the screen has been empty, and how long it must be before the next word. */
  private emptyFor = 0;
  private waitFor: number = PRACTICE_RAMP.firstSpawnAt;
  /** Ramp: when the next word is due (never, until the player is placed). */
  private nextAt = Number.POSITIVE_INFINITY;
  /** The ramp clock, in ramp seconds (not capped: `rampAt` caps it). */
  private rampClock = 0;

  /** The difficulty level right now, in ramp seconds (0..`rampSeconds`); `null` while calibrating. */
  get rampTime(): number | null {
    return this.phase === 'ramp' ? Math.min(this.rampClock, PRACTICE_RAMP.rampSeconds) : null;
  }

  constructor(options: PracticeDirectorOptions) {
    for (const tier of TIERS) {
      if (options.list[tier].length === 0) throw new Error(`Word list has no ${tier} words`);
    }
    this.list = options.list;
    this.random = options.random ?? Math.random;
  }

  /**
   * Ends calibration: places the player from their measured Pace (letters per second) and returns the ramp
   * time they start at. The first word at the new level comes `PRACTICE_RAMP.firstSpawnAt` later.
   */
  finishCalibration(pace: number): number {
    this.startLevel = startLevelFor(pace, this.list);
    this.phase = 'ramp';
    this.rampClock = this.startLevel;
    this.nextAt = this.elapsed + PRACTICE_RAMP.firstSpawnAt;
    return this.startLevel;
  }

  /**
   * Moves time on by `dt` seconds. `inFlight` = the words of the Word bullets on screen: they are not repeated,
   * and when there are none the ramp runs faster for this step.
   */
  advance(dt: number, inFlight: readonly string[]): Spawn[] {
    if (!(dt > 0)) return [];
    this.elapsed += dt;
    return this.phase === 'calibrating' ? this.advanceCalibration(dt, inFlight) : this.advanceRamp(dt, inFlight);
  }

  /** One word at a time: the next one comes once the screen has been empty for `waitFor` seconds. */
  private advanceCalibration(dt: number, inFlight: readonly string[]): Spawn[] {
    if (inFlight.length > 0) {
      this.emptyFor = 0;
      return [];
    }
    this.emptyFor += dt;
    if (this.emptyFor < this.waitFor) return [];
    this.emptyFor = 0;
    this.waitFor = PRACTICE_CALIBRATION.gap;
    const word = this.pickWord(PRACTICE_CALIBRATION.weights, new Set(inFlight));
    return [{ word, flightSeconds: PRACTICE_CALIBRATION.flightSeconds }];
  }

  private advanceRamp(dt: number, inFlight: readonly string[]): Spawn[] {
    const rate = inFlight.length === 0 ? PRACTICE_ACCELERATION.emptyScreenRate : 1;
    this.rampClock += dt * rate;
    const taken = new Set(inFlight);
    const out: Spawn[] = [];
    while (this.nextAt <= this.elapsed) {
      // The difficulty at the moment the word was due, counted back from the ramp clock now.
      const step = rampAt(this.rampClock - (this.elapsed - this.nextAt) * rate);
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
