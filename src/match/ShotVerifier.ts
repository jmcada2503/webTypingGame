import type { WordList } from '../words/wordLists';
import { pick } from './attackWords';

/** The part of a `shot` NetEvent the verifier checks. */
export interface ShotClaim {
  i: number;
  t: number;
  word: string;
}

/** Why a Shot was ignored. `duplicate` is a harmless repeat; the rest are logged as `invalid_attack`. */
export type RejectReason = 'malformed' | 'duplicate' | 'bad_index' | 'bad_time' | 'non_monotonic' | 'bad_word';

export type VerifyResult = { ok: true } | { ok: false; reason: RejectReason };

/** What the verifier reports for the metrics: plain data, safe to log as JSON. */
export type AttackAudit =
  /** A Shot that was ignored because it didn't match the seed or the clock. */
  | { kind: 'invalid_attack'; reason: Exclude<RejectReason, 'duplicate'>; i: number; t: number; word: string; expectedWord?: string; expectedT?: number }
  /** An accepted Shot whose `t` was close to the tolerance: data for tuning it. */
  | { kind: 'near_miss'; i: number; deviation: number; tolerance: number };

export interface ShotVerifierOptions {
  /** The opponent's seed. */
  seed: number;
  /** The same word list the opponent uses. */
  list: WordList;
  /** The index the opponent's first Shot has: 0, or where the last Match stopped after a Rematch. */
  startIndex?: number;
  /** Seconds `t` may be off. Default 1, to be tuned with the near-miss logs. */
  toleranceSeconds?: number;
  /** Estimated one-way network delay in seconds (half the round trip). Default: 0. */
  oneWayLatency?: () => number;
  report?: (audit: AttackAudit) => void;
}

const DEFAULT_TOLERANCE = 1;
/** An accepted Shot this far into the tolerance (as a share of it) is logged as a near miss. */
const NEAR_MISS_SHARE = 0.5;
/** Longest word copied into a log entry: a cheater could send anything. */
const LOG_WORD_MAX = 40;

/**
 * Checks the opponent's Shots against their seed. Shot `i` carries `t_i`, the Match time its word was
 * picked, which is the moment the previous Shot was fired. So it must be:
 * - the next index in the sequence (otherwise a cheater could skip ahead to easy words);
 * - close to when the previous Shot arrived, minus the network delay (`t_0` is exactly 0, also on a Rematch);
 * - not earlier than the previous Shot's `t`;
 * - the word `pick(seed, i, t_i)`.
 * Only accepted Shots move the sequence on, so a bad Shot can't be used to skip a word. The trade-off:
 * if an honest Shot is wrongly rejected (clocks more than the tolerance apart), the rest of that
 * player's Shots are rejected too, which is why near misses are logged.
 */
export class ShotVerifier {
  private expectedIndex: number;
  /** Match time the last accepted Shot arrived, and its `t`; none before the first one. */
  private last: { arrivedAt: number; t: number } | null = null;
  private readonly tolerance: number;

  constructor(private readonly options: ShotVerifierOptions) {
    this.expectedIndex = options.startIndex ?? 0;
    this.tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE;
  }

  /** `arrivedAt` is the Match time (seconds) the Shot arrived. */
  verify(shot: ShotClaim, arrivedAt: number): VerifyResult {
    if (!Number.isInteger(shot.i) || shot.i < 0 || !Number.isFinite(shot.t) || typeof shot.word !== 'string') {
      return this.reject('malformed', shot);
    }
    if (shot.i < this.expectedIndex) return { ok: false, reason: 'duplicate' };
    if (shot.i > this.expectedIndex) return this.reject('bad_index', shot);

    const expectedT = this.last ? this.last.arrivedAt - (this.options.oneWayLatency?.() ?? 0) : 0;
    const deviation = Math.abs(shot.t - expectedT);
    // The first Shot of a Match is picked at exactly t = 0.
    if (this.last ? deviation > this.tolerance : shot.t !== 0) return this.reject('bad_time', shot, { expectedT });
    if (this.last && shot.t < this.last.t) return this.reject('non_monotonic', shot, { expectedT });
    const expectedWord = pick(this.options.seed, shot.i, shot.t, this.options.list);
    if (shot.word !== expectedWord) return this.reject('bad_word', shot, { expectedWord });

    if (this.last && deviation > this.tolerance * NEAR_MISS_SHARE) {
      this.options.report?.({ kind: 'near_miss', i: shot.i, deviation, tolerance: this.tolerance });
    }
    this.expectedIndex = shot.i + 1;
    this.last = { arrivedAt, t: shot.t };
    return { ok: true };
  }

  private reject(reason: Exclude<RejectReason, 'duplicate'>, shot: ShotClaim, expected: { expectedWord?: string; expectedT?: number } = {}): VerifyResult {
    this.options.report?.({
      kind: 'invalid_attack',
      reason,
      i: shot.i,
      t: shot.t,
      word: typeof shot.word === 'string' ? shot.word.slice(0, LOG_WORD_MAX) : '',
      ...expected,
    });
    return { ok: false, reason };
  }
}
