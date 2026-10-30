import type { FlowState, Language, MatchKind } from '../flow/types';
import type { MatchDetails, MatchStats } from '../match/MatchEngine';
import type { ConnectionRecord } from '../net/errors';
import type { PracticeResult } from '../practice/PracticeSession';
import type { MatchEnding, MetricRecord, RematchRecord } from './records';

export interface TrackerDeps {
  report: (record: MetricRecord) => void;
  /** The language the player chose (searching and Practice use it). */
  language: () => Language;
  /** Wall clock, ms. */
  now: () => number;
  /** The online Match being played (or just played). */
  match: () => { stats: MatchStats; details: MatchDetails } | null;
  /** The Practice run being played (or just played). */
  practice: () => { result: PracticeResult; missed: string[] } | null;
  /** The opponent connection the Match runs on. */
  online: () => { matchId: string; lang: Language; rttMs: number | null } | null;
  randomId?: () => string;
}

const LETTERS_PER_WORD = 5;
/** How-to seconds left above which leaving it counts as skipping it (Enter), not the auto-start. */
const SKIP_SLACK_SECONDS = 0.25;

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;
const randomId = () => Math.random().toString(36).slice(2, 12).padEnd(6, '0');

/**
 * Turns what the player goes through into metrics records. It watches the screen flow (`observe`, every
 * frame or so) and is told about connection attempts and Shot checks; it never changes the game.
 * - leaving a Match → `match` (my side), leaving a Practice run → `practice`
 * - leaving the waiting screen before an opponent was found → `mm`
 * - leaving an online end screen → `rematch` (how the offer was settled)
 */
export class MetricsTracker {
  private prev: FlowState | null = null;
  private kind: MatchKind = 'public';
  private waitStart: number | null = null;
  /** Matchmaking wait and how-to choice, for the first Match of the next connection. */
  private pendingWait: number | null = null;
  private pendingHowto: 'skipped' | 'auto' | null = null;
  private lastHowto: 'skipped' | 'auto' | null = null;
  /** The Match being played: its connection, number on it, and the checks of the opponent's Shots. */
  private current: { mid: string; n: number; lang: Language; rtt: number | null; wait: number | null; howto: 'skipped' | 'auto' | null; invalid: number; near: number } | null = null;
  private played = new Map<string, number>();
  /** Last Match's connection and number, and what the Rematch offer went through. */
  private rematch: { mid: string; n: number; sawDeclined: boolean; sawExpired: boolean; sawLeft: boolean } | null = null;

  constructor(private readonly deps: TrackerDeps) {}

  /** The flow's state right now. Compares with the last one seen and reports what ended. */
  observe(next: FlowState) {
    const prev = this.prev;
    this.prev = next;
    if (!prev) return;
    if (prev.screen === 'end' && prev.mode === 'versus') this.watchRematch(prev);
    if (prev.screen === next.screen && !(next.screen === 'waiting' && prev.screen === 'waiting' && prev.phase !== next.phase)) return;

    if (prev.screen === 'howto' && next.screen === 'waiting') {
      this.lastHowto = prev.secondsLeft > SKIP_SLACK_SECONDS ? 'skipped' : 'auto';
    }
    if (next.screen === 'waiting' && prev.screen !== 'waiting') {
      this.kind = next.kind;
      this.waitStart = this.deps.now();
      if (prev.screen !== 'howto') this.lastHowto = null; // Search again: no how-to this time
    }
    if (prev.screen === 'waiting' && prev.phase === 'searching' && (next.screen !== 'waiting' || next.phase === 'connecting')) {
      this.leftSearching(next);
    }
    if (prev.screen === 'end' && prev.mode === 'versus') this.rematchSettled(next.screen === 'countdown' || next.screen === 'starting' || next.screen === 'match');
    if (next.screen === 'match' && prev.screen !== 'match' && next.mode === 'versus') this.matchBegan();
    if (prev.screen === 'match' && next.screen !== 'match') {
      if (prev.mode === 'practice') this.practiceEnded();
      else this.matchEnded(endingOf(next));
    }
  }

  /** One connection attempt to an opponent, success or failure. */
  connection(record: ConnectionRecord, match: { matchId: string; kind: MatchKind }) {
    const { local, remote } = record.candidates;
    this.deps.report({
      t: 'p2p',
      mid: match.matchId,
      kind: match.kind,
      role: record.role,
      ok: record.failure === null,
      fail: record.failure,
      pair: record.pairType,
      ms: record.connectMs,
      gather: record.gatherMs,
      ice: record.iceTimeline.slice(0, 20).map((e) => ({ s: e.state, ms: e.atMs })),
      cand: { lh: local.host, ls: local.srflx, lr: local.relay, rh: remote.host, rs: remote.srflx, rr: remote.relay },
    });
  }

  /** The seed check on one of the opponent's Shots flagged it. */
  shotAudit(kind: 'invalid_attack' | 'near_miss') {
    if (!this.current) return;
    if (kind === 'invalid_attack') this.current.invalid++;
    else this.current.near++;
  }

  /** The tab is going away: a Match or Practice run still on counts as quit. */
  pageHidden() {
    const s = this.prev;
    if (s?.screen !== 'match') return;
    if (s.mode === 'practice') this.practiceEnded();
    else this.matchEnded('quit');
    this.prev = null;
  }

  // ---- internals ----

  private leftSearching(next: FlowState) {
    if (this.waitStart === null) return;
    const wait = Math.max(0, Math.round(this.deps.now() - this.waitStart));
    this.waitStart = null;
    const matched = (next.screen === 'waiting' && next.phase === 'connecting') || next.screen === 'countdown';
    if (matched) {
      this.pendingWait = wait;
      this.pendingHowto = this.lastHowto;
      return;
    }
    const why = next.screen === 'menu' && next.serversResting ? 'resting' : next.screen === 'error' ? 'error' : 'left';
    this.deps.report({ t: 'mm', kind: this.kind, lang: this.deps.language(), wait, why });
  }

  private matchBegan() {
    const online = this.deps.online();
    const mid = online?.matchId ?? `local${randomId()}`.slice(0, 32);
    const n = this.played.get(mid) ?? 0;
    this.played.set(mid, n + 1);
    const first = n === 0;
    this.current = {
      mid,
      n,
      lang: online?.lang ?? this.deps.language(),
      rtt: online?.rttMs ?? null,
      wait: first ? this.pendingWait : null,
      howto: first ? this.pendingHowto : null,
      invalid: 0,
      near: 0,
    };
    this.pendingWait = null;
    this.pendingHowto = null;
  }

  private matchEnded(end: MatchEnding) {
    const c = this.current;
    const played = this.deps.match();
    this.current = null;
    if (!c || !played) return;
    const { stats: s, details: d } = played;
    const submits = s.correctWords + s.wrongSubmits;
    const pace = s.elapsed > 0 ? s.correctLetters / s.elapsed : 0;
    // At the end if the connection is still there (more pings measured), else what it was at the start.
    const rtt = this.deps.online()?.rttMs ?? c.rtt;
    this.deps.report({
      t: 'match',
      mid: c.mid,
      n: c.n,
      kind: this.kind,
      lang: c.lang,
      end,
      at: Math.round(this.deps.now()),
      dur: round(s.elapsed),
      pace: round(pace),
      peak: round(Math.max(d.peakPace, pace)),
      wpm: round((pace * 60) / LETTERS_PER_WORD, 1),
      acc: submits > 0 ? round(s.correctWords / submits) : null,
      words: s.correctWords,
      letters: s.correctLetters,
      wrong: s.wrongSubmits,
      missed: d.missed,
      bd: s.bulletsDestroyed,
      ba: s.bulletsArrived,
      sf: s.shotsFired,
      sh: s.shotsHit,
      sd: s.shotsDefended,
      lives: d.lives,
      attacks: d.attacks,
      wait: c.wait,
      howto: c.howto,
      rtt: rtt == null ? null : Math.round(rtt),
      invalid: c.invalid,
      near: c.near,
    });
    this.rematch = { mid: c.mid, n: c.n, sawDeclined: false, sawExpired: false, sawLeft: false };
  }

  private practiceEnded() {
    const run = this.deps.practice();
    if (!run) return;
    const r = run.result;
    this.deps.report({
      t: 'practice',
      rid: (this.deps.randomId ?? randomId)(),
      lang: this.deps.language(),
      at: Math.round(this.deps.now()),
      dur: round(r.survivedSeconds),
      active: round(r.activeSeconds),
      pace: round(r.averagePace),
      peak: round(r.peakPace),
      wpm: round(r.wpm, 1),
      acc: r.accuracy === null ? null : round(r.accuracy),
      words: r.wordsTyped,
      letters: r.lettersTyped,
      wrong: r.wrongSubmits,
      missed: run.missed,
      calib: r.calibrationPace === null ? null : round(r.calibrationPace),
      start: r.startLevel === null ? null : round(r.startLevel),
      level: r.currentLevel === null ? null : round(r.currentLevel),
    });
  }

  private watchRematch(s: Extract<FlowState, { screen: 'end'; mode: 'versus' }>) {
    const r = this.rematch;
    if (!r) return;
    const offer = s.rematch;
    if (offer.status === 'notice' && offer.notice === 'declined') r.sawDeclined = true;
    if (offer.status === 'notice' && offer.notice !== 'declined') r.sawExpired = true;
    if (offer.status === 'opponentLeft') r.sawLeft = true;
  }

  private rematchSettled(played: boolean) {
    const r = this.rematch;
    this.rematch = null;
    if (!r) return;
    const out: RematchRecord['out'] = played ? 'played' : r.sawDeclined ? 'declined' : r.sawExpired ? 'expired' : r.sawLeft ? 'left' : 'closed';
    this.deps.report({ t: 'rematch', mid: r.mid, kind: this.kind, n: r.n, out });
  }
}

function endingOf(next: FlowState): MatchEnding {
  if (next.screen === 'end' && next.mode === 'versus') return next.result;
  if (next.screen === 'opponentLeft') return 'opponentLeft';
  return 'quit';
}
