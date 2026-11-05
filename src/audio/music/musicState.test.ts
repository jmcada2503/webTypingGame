import { describe, expect, test } from 'vitest';
import type { FlowState, RematchState } from '../../flow/types';
import { endMoodOf, musicStateOf } from './musicState';

const available: RematchState = { status: 'available', secondsLeft: 10 };
const end = (result: 'won' | 'lost' | 'peace'): FlowState => ({ screen: 'end', mode: 'versus', result, kind: 'public', rematch: available });
const practiceOver: FlowState = { screen: 'end', mode: 'practice', result: 'practiceOver' };

describe('which part of the music plays', () => {
  test('menu music on every screen outside a Match', () => {
    const screens: FlowState[] = [
      { screen: 'menu', serversResting: false, language: 'en' },
      { screen: 'howto', kind: 'public', secondsLeft: 20 },
      { screen: 'waiting', kind: 'public', phase: 'searching' },
      { screen: 'opponentLeft', during: 'match', youWin: true, keptDropping: false, kind: 'public' },
      { screen: 'error', reason: 'connectFailed', kind: 'public' },
    ];
    expect(screens.map((s) => musicStateOf(s, 'menu'))).toEqual(['menu', 'menu', 'menu', 'menu', 'menu']);
  });

  test('the Countdown, the TV gap, the Match, and the Match held while the signal is lost', () => {
    expect(musicStateOf({ screen: 'countdown', mode: 'versus', secondsLeft: 3 }, 'countdown')).toBe('countdown');
    expect(musicStateOf({ screen: 'starting', mode: 'practice' }, 'match')).toBe('starting');
    expect(musicStateOf({ screen: 'match', mode: 'versus', link: { status: 'ok' } }, 'match')).toBe('match');
    expect(musicStateOf({ screen: 'match', mode: 'versus', link: { status: 'away', secondsLeft: 8, losses: 1 } }, 'match')).toBe('held');
    expect(musicStateOf({ screen: 'match', mode: 'versus', link: { status: 'back', secondsLeft: 3 } }, 'match')).toBe('held');
  });

  test('while the ending scene still plays, its own music; Practice ends as a loss', () => {
    expect(musicStateOf(end('won'), 'match')).toBe('endingWin');
    expect(musicStateOf(end('lost'), 'match')).toBe('endingLose');
    expect(musicStateOf(end('peace'), 'match')).toBe('endingPeace');
    expect(musicStateOf(practiceOver, 'match')).toBe('endingLose');
  });

  test('then the end screen loop, its harmony following the result', () => {
    expect(musicStateOf(end('won'), 'end')).toBe('end');
    expect([endMoodOf(end('won')), endMoodOf(end('peace')), endMoodOf(end('lost')), endMoodOf(practiceOver)]).toEqual([1, 0, -1, -1]);
  });
});
