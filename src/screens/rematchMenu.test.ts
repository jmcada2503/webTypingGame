import { describe, expect, test } from 'vitest';
import type { RematchState } from '../flow/types';
import { rematchMenu } from './rematchMenu';

const ids = (r: RematchState, kind: 'public' | 'private' = 'public') => rematchMenu(r, kind).options.map((o) => o.id);

describe('options', () => {
  test('Public offers Rematch, a new search and the menu; Private only Rematch and the menu', () => {
    expect(ids({ status: 'available', secondsLeft: 6 })).toEqual(['rematch', 'search', 'menu']);
    expect(ids({ status: 'available', secondsLeft: null }, 'private')).toEqual(['rematch', 'menu']);
  });

  test('while waiting only Cancel, while they are waiting Accept and Deny', () => {
    expect(ids({ status: 'waiting', answerSecondsLeft: 8, secondsLeft: 3 })).toEqual(['cancel']);
    expect(ids({ status: 'incoming', answerSecondsLeft: 8, secondsLeft: 3 })).toEqual(['accept', 'deny']);
  });

  test('once Rematch is closed or the opponent left, no Rematch: Public keeps the new search', () => {
    expect(ids({ status: 'closed' })).toEqual(['search', 'menu']);
    expect(ids({ status: 'opponentLeft' })).toEqual(['search', 'menu']);
    expect(ids({ status: 'opponentLeft' }, 'private')).toEqual(['menu']);
  });

  test('a notice shows the options it is about to return to: Rematch again only while the window lasts', () => {
    const notice = (secondsLeft: number | null, closes = false): RematchState => ({ status: 'notice', notice: 'noAnswer', noticeSecondsLeft: 1, secondsLeft, closes });
    expect(ids(notice(4))).toEqual(['rematch', 'search', 'menu']);
    expect(ids(notice(0))).toEqual(['search', 'menu']);
    expect(ids(notice(4, true))).toEqual(['search', 'menu']); // denied in Public
    expect(ids(notice(null), 'private')).toEqual(['rematch', 'menu']);
  });
});

describe('status line', () => {
  test('says what is happening', () => {
    expect(rematchMenu({ status: 'available', secondsLeft: 5 }, 'public').status).toBeNull();
    expect(rematchMenu({ status: 'waiting', answerSecondsLeft: 8, secondsLeft: 3 }, 'public').status).toEqual({ text: 'WAITING FOR OPPONENT', color: 'yellow', dots: true });
    expect(rematchMenu({ status: 'incoming', answerSecondsLeft: 8, secondsLeft: 3 }, 'public').status).toEqual({ text: 'OPPONENT WANTS A REMATCH', color: 'yellow', dots: false });
    expect(rematchMenu({ status: 'closed' }, 'public').status).toEqual({ text: 'REMATCH CLOSED', color: 'dim', dots: false });
    expect(rematchMenu({ status: 'opponentLeft' }, 'public').status).toEqual({ text: 'OPPONENT LEFT', color: 'red', dots: false });
  });

  test('notices: NO ANSWER (mine), TOO LATE (theirs), DECLINED', () => {
    const text = (notice: 'noAnswer' | 'tooLate' | 'declined') => rematchMenu({ status: 'notice', notice, noticeSecondsLeft: 1, secondsLeft: 4, closes: false }, 'public').status?.text;
    expect([text('noAnswer'), text('tooLate'), text('declined')]).toEqual(['NO ANSWER', 'TOO LATE', 'DECLINED']);
  });
});

describe('bar', () => {
  test('the window bar (Public): yellow, red in the last 3 seconds, with the seconds left', () => {
    expect(rematchMenu({ status: 'available', secondsLeft: 5 }, 'public').bar).toEqual({ kind: 'window', fraction: 0.5, seconds: 5, color: 'yellow', caption: null });
    expect(rematchMenu({ status: 'available', secondsLeft: 3 }, 'public').bar).toMatchObject({ color: 'red' });
  });

  test('no window bar in Private', () => {
    expect(rematchMenu({ status: 'available', secondsLeft: null }, 'private').bar).toBeNull();
  });

  test('a request replaces the window bar with the answer-time bar: green, red in the last 1.5 s, captioned', () => {
    expect(rematchMenu({ status: 'waiting', answerSecondsLeft: 10, secondsLeft: 2 }, 'public').bar).toEqual({ kind: 'answer', fraction: 1, seconds: 10, color: 'green', caption: 'TIME FOR THEM TO ANSWER' });
    expect(rematchMenu({ status: 'incoming', answerSecondsLeft: 1.2, secondsLeft: 0 }, 'public').bar).toEqual({ kind: 'answer', fraction: 0.12, seconds: 2, color: 'red', caption: 'TIME TO ANSWER' });
  });

  test('no bar during a notice or once closed', () => {
    expect(rematchMenu({ status: 'closed' }, 'public').bar).toBeNull();
    expect(rematchMenu({ status: 'notice', notice: 'declined', noticeSecondsLeft: 1, secondsLeft: 4, closes: true }, 'public').bar).toBeNull();
  });
});
