import { describe, expect, it } from 'vitest';
import type { FlowState, RematchState } from '../flow/types';
import type { MatchDetails, MatchStats } from '../match/MatchEngine';
import type { ConnectionRecord } from '../net/errors';
import type { PracticeResult } from '../practice/PracticeSession';
import { MetricsTracker } from './MetricsTracker';
import type { MetricRecord } from './records';

const STATS: MatchStats = { elapsed: 60, correctWords: 30, correctLetters: 150, wrongSubmits: 10, bulletsDestroyed: 20, bulletsArrived: 3, shotsFired: 10, shotsHit: 4, shotsDefended: 5 };
const DETAILS: MatchDetails = { lives: 0, peakPace: 4, missed: ['nebula'], attacks: [{ i: 0, w: 'rocket', t: 2, o: 'hit' }] };
const PRACTICE: PracticeResult = {
  survivedSeconds: 80, activeSeconds: 70, wordsTyped: 40, lettersTyped: 200, wrongSubmits: 0, accuracy: 1, averagePace: 2.857, peakPace: 4, wpm: 34.28,
  calibrationPace: 3, startLevel: 10, currentLevel: 50,
};

const menu: FlowState = { screen: 'menu', serversResting: false, language: 'en' };
const howto = (secondsLeft: number): FlowState => ({ screen: 'howto', kind: 'public', secondsLeft });
const searching: FlowState = { screen: 'waiting', kind: 'public', phase: 'searching' };
const connecting: FlowState = { screen: 'waiting', kind: 'public', phase: 'connecting' };
const countdown: FlowState = { screen: 'countdown', mode: 'versus', secondsLeft: 5 };
const versus: FlowState = { screen: 'match', mode: 'versus' };
const practice: FlowState = { screen: 'match', mode: 'practice' };
const end = (result: 'won' | 'lost' | 'peace', rematch: RematchState = { status: 'available', secondsLeft: 10 }): FlowState => ({ screen: 'end', mode: 'versus', result, kind: 'public', rematch });

function setup() {
  let now = 1_790_000_000_000;
  const reports: MetricRecord[] = [];
  const tracker = new MetricsTracker({
    report: (r) => reports.push(r),
    language: () => 'es',
    now: () => now,
    match: () => ({ stats: STATS, details: DETAILS }),
    practice: () => ({ result: PRACTICE, missed: ['casa'] }),
    online: () => ({ matchId: 'abc123', lang: 'es', rttMs: 41.6 }),
    randomId: () => 'run123',
  });
  const go = (...states: FlowState[]) => states.forEach((s) => tracker.observe(s));
  const wait = (ms: number) => (now += ms);
  return { tracker, reports, go, wait };
}

describe('a Match', () => {
  it('reports my side when it ends, with the wait and the skipped how-to', () => {
    const { reports, go, wait } = setup();
    go(menu, howto(20), searching);
    wait(4200);
    go(connecting, countdown, versus, end('won'));
    expect(reports).toEqual([
      expect.objectContaining({ t: 'match', mid: 'abc123', n: 0, kind: 'public', lang: 'es', end: 'won', wait: 4200, howto: 'skipped', rtt: 42, dur: 60, pace: 2.5, wpm: 30, acc: 0.75, peak: 4, lives: 0, missed: ['nebula'], attacks: DETAILS.attacks }),
    ]);
  });

  it('the how-to that ran out counts as auto', () => {
    const { reports, go } = setup();
    go(menu, howto(0), searching, countdown, versus, end('lost'));
    expect(reports[0]).toMatchObject({ howto: 'auto', end: 'lost' });
  });

  it('a Rematch is Match 1 on the same connection, with no wait; the offer counts as played', () => {
    const { reports, go } = setup();
    go(menu, howto(5), searching, countdown, versus, end('won'), countdown, versus, end('peace'));
    expect(reports.map((r) => r.t)).toEqual(['match', 'rematch', 'match']);
    expect(reports[1]).toMatchObject({ t: 'rematch', mid: 'abc123', n: 0, out: 'played' });
    expect(reports[2]).toMatchObject({ n: 1, wait: null, howto: null, end: 'peace' });
  });

  it('the opponent leaving mid-Match, and closing the tab, are endings too', () => {
    const left = setup();
    left.go(menu, howto(5), searching, countdown, versus, { screen: 'opponentLeft', during: 'match', youWin: true, kind: 'public' });
    expect(left.reports[0]).toMatchObject({ end: 'opponentLeft' });

    const quit = setup();
    quit.go(menu, howto(5), searching, countdown, versus);
    quit.tracker.pageHidden();
    expect(quit.reports[0]).toMatchObject({ end: 'quit' });
    quit.tracker.pageHidden();
    expect(quit.reports).toHaveLength(1);
  });

  it('counts the Shot checks during the Match', () => {
    const { tracker, reports, go } = setup();
    go(menu, howto(5), searching, countdown, versus);
    tracker.shotAudit('invalid_attack');
    tracker.shotAudit('near_miss');
    tracker.shotAudit('near_miss');
    go(end('won'));
    expect(reports[0]).toMatchObject({ invalid: 1, near: 2 });
  });
});

describe('the Rematch offer', () => {
  const settle = (...offers: RematchState[]) => {
    const { reports, go } = setup();
    go(menu, howto(5), searching, countdown, versus, ...offers.map((o) => end('won', o)), menu);
    return reports.find((r) => r.t === 'rematch');
  };
  it('declined, expired, opponent gone, or nobody proposed', () => {
    expect(settle({ status: 'notice', notice: 'declined', noticeSecondsLeft: 2, secondsLeft: 5, closes: true }, { status: 'closed' })).toMatchObject({ out: 'declined' });
    expect(settle({ status: 'waiting', answerSecondsLeft: 5, secondsLeft: 5 }, { status: 'notice', notice: 'noAnswer', noticeSecondsLeft: 2, secondsLeft: 0, closes: true })).toMatchObject({ out: 'expired' });
    expect(settle({ status: 'opponentLeft' })).toMatchObject({ out: 'left' });
    expect(settle({ status: 'available', secondsLeft: 3 }, { status: 'closed' })).toMatchObject({ out: 'closed' });
  });
});

describe('Matchmaking', () => {
  it('leaving the search reports a give-up with the wait', () => {
    const { reports, go, wait } = setup();
    go(menu, howto(5), searching);
    wait(30_000);
    go(menu);
    expect(reports).toEqual([{ t: 'mm', kind: 'public', lang: 'es', wait: 30_000, why: 'left' }]);
  });

  it('servers going to rest while searching', () => {
    const { reports, go } = setup();
    go(menu, howto(5), searching, { ...menu, serversResting: true });
    expect(reports[0]).toMatchObject({ t: 'mm', why: 'resting' });
  });

  it('a connection failing after the pairing is not a give-up', () => {
    const { reports, go } = setup();
    go(menu, howto(5), searching, connecting, { screen: 'error', reason: 'connectFailed', kind: 'public' });
    expect(reports).toEqual([]);
  });
});

describe('Practice', () => {
  it('reports the run when it ends', () => {
    const { reports, go } = setup();
    go(menu, { screen: 'starting', mode: 'practice' }, practice, { screen: 'end', mode: 'practice', result: 'practiceOver' });
    expect(reports).toEqual([expect.objectContaining({ t: 'practice', rid: 'run123', lang: 'es', dur: 80, active: 70, wpm: 34.3, missed: ['casa'], calib: 3 })]);
  });
});

describe('connection attempts', () => {
  it('a failure keeps its ICE timeline and the candidates each side offered', () => {
    const { tracker, reports } = setup();
    const record: ConnectionRecord = {
      role: 'guest', iceTimeline: [{ atMs: 300, state: 'checking' }, { atMs: 9000, state: 'failed' }], gatherMs: 200, pairType: null, connectMs: null,
      failure: 'iceFailed', browser: 'Safari', candidates: { local: { host: 2, srflx: 0, relay: 0 }, remote: { host: 1, srflx: 1, relay: 0 } },
    };
    tracker.connection(record, { matchId: 'abc123', kind: 'private' });
    expect(reports).toEqual([
      { t: 'p2p', mid: 'abc123', kind: 'private', role: 'guest', ok: false, fail: 'iceFailed', pair: null, ms: null, gather: 200,
        ice: [{ s: 'checking', ms: 300 }, { s: 'failed', ms: 9000 }], cand: { lh: 2, ls: 0, lr: 0, rh: 1, rs: 1, rr: 0 } },
    ]);
  });
});
