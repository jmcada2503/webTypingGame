import { describe, expect, test } from 'vitest';
import type { FlowState, MatchLink, RematchState } from '../flow/types';
import { screenCues, type CueMoment } from './screenCues';

const MENU: FlowState = { screen: 'menu', serversResting: false, language: 'en' };
const GLITCH = 4;
const TV = 2;
const at = (flow: FlowState, mode = 0, level = 0): CueMoment => ({ flow, effect: { mode, level } });
/** The sounds over a run of frames. */
const played = (...frames: CueMoment[]) => frames.slice(1).flatMap((m, i) => screenCues(frames[i], m).play);

describe('screen-change effects', () => {
  test('the glitch plays once, when it starts', () => {
    expect(played(at(MENU), at(MENU, GLITCH, 0.2), at(MENU, GLITCH, 1), at(MENU, GLITCH, 0.3), at(MENU))).toEqual(['glitch']);
  });

  test('TV off plays when the picture starts to go, TV on when it comes back', () => {
    expect(played(at(MENU), at(MENU, TV, 0.1), at(MENU, TV, 1), at(MENU, TV, 1), at(MENU, TV, 0.95), at(MENU, TV, 0.6), at(MENU, TV, 0.1), at(MENU))).toEqual(['tvOff', 'tvOn']);
  });
});

const OK: MatchLink = { status: 'ok' };
const match = (mode: 'versus' | 'practice' = 'versus', link: MatchLink = OK): FlowState => ({ screen: 'match', mode, link });
const end = (result: 'won' | 'lost' | 'peace', rematch: RematchState = { status: 'available', secondsLeft: 10 }): FlowState => ({ screen: 'end', mode: 'versus', result, kind: 'public', rematch });
const countdown = (secondsLeft: number): FlowState => ({ screen: 'countdown', mode: 'versus', secondsLeft });

describe('the Match starting and ending', () => {
  test('each ending has its own sound; Practice always ends in the Lose ending', () => {
    expect(played(at(match()), at(end('won')))).toEqual(['winEnding']);
    expect(played(at(match()), at(end('lost')))).toEqual(['loseEnding']);
    expect(played(at(match()), at(end('peace')))).toEqual(['peaceEnding']);
    expect(played(at(match('practice')), at({ screen: 'end', mode: 'practice', result: 'practiceOver' }))).toEqual(['loseEnding']);
  });

  test('the Countdown ticks once a second, 5 to 1, then GO', () => {
    const frames = [at({ screen: 'waiting', kind: 'public', phase: 'connecting' }), ...[5, 4.6, 4, 3.2, 2.9, 1.5, 0.5].map((t) => at(countdown(t))), at({ screen: 'starting', mode: 'versus' }), at(match())];
    expect(played(...frames)).toEqual(['countdownTick', 'countdownTick', 'countdownTick', 'countdownTick', 'countdownTick', 'go']);
  });

  test('Practice starts with no GO', () => {
    expect(played(at({ screen: 'starting', mode: 'practice' }), at(match('practice')))).toEqual([]);
  });

  test('an opponent found makes a sound', () => {
    expect(played(at({ screen: 'waiting', kind: 'public', phase: 'searching' }), at({ screen: 'waiting', kind: 'public', phase: 'connecting' }))).toEqual(['opponentFound']);
  });

  test('an opponent found and connected in the same moment still sounds, with the first tick', () => {
    expect(played(at({ screen: 'waiting', kind: 'public', phase: 'searching' }), at(countdown(5)))).toEqual(['opponentFound', 'countdownTick']);
  });
});

describe('after the Match', () => {
  const waiting: RematchState = { status: 'waiting', answerSecondsLeft: 10, secondsLeft: 9 };
  const incoming: RematchState = { status: 'incoming', answerSecondsLeft: 10, secondsLeft: 9 };
  const declined: RematchState = { status: 'notice', notice: 'declined', noticeSecondsLeft: 2.4, secondsLeft: 8, closes: true };

  test('a Rematch proposed (by me or by them) chimes once, not every frame of the wait', () => {
    expect(played(at(end('won')), at(end('won', waiting)), at(end('won', { ...waiting, answerSecondsLeft: 9 })))).toEqual(['rematchProposed']);
    expect(played(at(end('lost')), at(end('lost', incoming)))).toEqual(['rematchProposed']);
  });

  test('a declined Rematch sounds bad; an accepted one sounds good as the Countdown starts', () => {
    expect(played(at(end('won', waiting)), at(end('won', declined)))).toEqual(['rematchDeclined']);
    expect(played(at(end('won', incoming)), at(countdown(5)))).toEqual(['rematchAccepted', 'countdownTick']);
  });

  test('the opponent leaving the Match is a win; leaving before it is a neutral sting', () => {
    expect(played(at(match()), at({ screen: 'opponentLeft', during: 'match', youWin: true, keptDropping: false, kind: 'public' }))).toEqual(['opponentLeftWin']);
    expect(played(at(countdown(3)), at({ screen: 'opponentLeft', during: 'countdown', youWin: false, keptDropping: false, kind: 'public' }))).toEqual(['errorSting']);
  });

  test('an error, or the servers starting to rest, stings once', () => {
    expect(played(at({ screen: 'waiting', kind: 'public', phase: 'connecting' }), at({ screen: 'error', reason: 'connectFailed', kind: 'public' }))).toEqual(['errorSting']);
    expect(played(at(MENU), at({ ...MENU, serversResting: true }), at({ ...MENU, serversResting: true }))).toEqual(['errorSting']);
  });
});

describe("the opponent's link", () => {
  const away = (secondsLeft: number, losses = 1) => at(match('versus', { status: 'away', secondsLeft, losses }));
  const back = (secondsLeft: number) => at(match('versus', { status: 'back', secondsLeft }));

  test('signal lost plays once per loss, and RECONNECTING loops while the signal is lost', () => {
    expect(played(at(match()), away(10), away(9.5), at(match()), away(10, 2))).toEqual(['signalLost', 'signalLost']);
    expect(screenCues(at(match()), away(10)).reconnecting).toBe(true);
    expect(screenCues(away(10), back(5.8)).reconnecting).toBe(false);
  });

  test('ENEMY BACK, then the resume ticks 5 to 1', () => {
    expect(played(away(4), back(5.8), back(5.3), back(5), back(4.2), back(3.9), back(2.5), back(1.2), back(0.4), at(match()))).toEqual(['enemyBack', 'resumeTick', 'resumeTick', 'resumeTick', 'resumeTick', 'resumeTick']);
  });
});
