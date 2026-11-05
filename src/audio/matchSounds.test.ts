import { describe, expect, test } from 'vitest';
import type { KeyPress } from '../match/types';
import { NOT_IDLE, type GameViewState, type ViewEvent } from '../view/GameViewState';
import { MatchSounds } from './matchSounds';
import { SOUNDS } from './sounds';

/** A MatchSounds that writes down what it was asked to play. */
function setup() {
  const played: string[] = [];
  return { sounds: new MatchSounds((id) => played.push(id)), played };
}

const state = (peaceIn: number | null): GameViewState => ({ lives: 3, typedWord: '', attackWord: 'rocket', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 }, idle: { ...NOT_IDLE, peaceIn } });

describe('key sounds', () => {
  test('a matching letter steps up the climb with its place in the word', () => {
    const { sounds, played } = setup();
    sounds.key({ kind: 'match', index: 0 });
    sounds.key({ kind: 'match', index: 1 });
    sounds.key({ kind: 'match', index: 4 });
    expect(played).toEqual(['keyClimb0', 'keyClimb1', 'keyClimb4']);
  });

  test('the climb stops at its top step on very long words', () => {
    const { sounds, played } = setup();
    sounds.key({ kind: 'match', index: 13 });
    sounds.key({ kind: 'match', index: 14 });
    sounds.key({ kind: 'match', index: 19 });
    expect(played).toEqual(['keyClimb13', 'keyClimb13', 'keyClimb13']);
  });

  test('no-match and Backspace have their own sounds', () => {
    const { sounds, played } = setup();
    sounds.key({ kind: 'noMatch' });
    sounds.key({ kind: 'backspace' });
    expect(played).toEqual(['keyNoMatch', 'keyBackspace']);
  });
});

describe('event sounds', () => {
  test.each([
    ['wordBulletDestroyed', { type: 'wordBulletDestroyed', id: 'e1' }],
    ['attackFired', { type: 'attackFired', id: 's0', word: 'rocket' }],
    ['shotHit', { type: 'shotHit', id: 's0' }],
    ['shotDefended', { type: 'shotDefended', id: 's0' }],
    ['enemyFired', { type: 'enemyFired', id: 'e1' }],
    ['closeWarning', { type: 'closeWarning', id: 'e1' }],
    ['lifeLost', { type: 'lifeLost' }],
    ['lastLife', { type: 'lastLife' }],
    ['wrongSubmit', { type: 'wrongSubmit' }],
    ['idleNudge', { type: 'idleNudge' }],
  ] as [string, ViewEvent][])('%s plays its sound', (id, event) => {
    const { sounds, played } = setup();
    sounds.events([event]);
    expect(played).toEqual([id]);
  });

  test('events the scene handles on its own make no sound here (arrivals are the Life lost; endings come later)', () => {
    const { sounds, played } = setup();
    sounds.events([{ type: 'wordBulletArrived', id: 'e1' }, { type: 'enemyDestroyed' }, { type: 'peace' }]);
    expect(played).toEqual([]);
  });

  test('several events in a frame play in order', () => {
    const { sounds, played } = setup();
    sounds.events([{ type: 'wordBulletArrived', id: 'e1' }, { type: 'lifeLost' }, { type: 'lastLife' }, { type: 'wordBulletDestroyed', id: 'e2' }]);
    expect(played).toEqual(['lifeLost', 'lastLife', 'wordBulletDestroyed']);
  });
});

describe('PEACE IN ticks', () => {
  test('one tick each time the whole number of seconds shown changes, including when it first appears', () => {
    const { sounds, played } = setup();
    sounds.frame(state(null));
    sounds.frame(state(4.2)); // shows 5
    sounds.frame(state(4.1));
    sounds.frame(state(4.0)); // still 4
    sounds.frame(state(3.9)); // shows 4
    expect(played).toEqual(['peaceTick', 'peaceTick']);
  });

  test('no ticks when nobody is heading for Peace, and a new Idle spell ticks again', () => {
    const { sounds, played } = setup();
    sounds.frame(state(null));
    sounds.frame(state(null));
    expect(played).toEqual([]);
    sounds.frame(state(2.5));
    sounds.frame(state(null)); // someone typed
    sounds.frame(state(2.5));
    expect(played).toEqual(['peaceTick', 'peaceTick']);
  });
});

describe('the sound bank', () => {
  test('every sound the match mapping can play exists in the bank', () => {
    const { sounds, played } = setup();
    const keys: KeyPress[] = [{ kind: 'noMatch' }, { kind: 'backspace' }, ...Array.from({ length: 20 }, (_, index): KeyPress => ({ kind: 'match', index }))];
    keys.forEach((k) => sounds.key(k));
    sounds.events([{ type: 'wordBulletDestroyed', id: 'a' }, { type: 'attackFired', id: 'a', word: 'w' }, { type: 'shotHit', id: 'a' }, { type: 'shotDefended', id: 'a' }, { type: 'enemyFired', id: 'a' }, { type: 'closeWarning', id: 'a' }, { type: 'lifeLost' }, { type: 'lastLife' }, { type: 'wrongSubmit' }, { type: 'idleNudge' }]);
    sounds.frame(state(3));
    expect(played.length).toBeGreaterThan(30);
    for (const id of new Set(played)) expect(Object.keys(SOUNDS), id).toContain(id);
  });

  test('keys are on the key-click bus (the toggle mutes them) but the warning sounds are not', () => {
    expect(SOUNDS.keyClimb0.bus).toBe('keyClicks');
    expect(SOUNDS.keyBackspace.bus).toBe('keyClicks');
    expect(SOUNDS.keyNoMatch.bus).toBe('effects');
    expect(SOUNDS.wrongSubmit.bus).toBe('effects');
  });
});
