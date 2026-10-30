import { describe, expect, test } from 'vitest';
import { nextWordId } from './nextWord';

const bullets = [
  { id: 'far', word: 'comet', flight: 0.2 },
  { id: 'mid', word: 'rocket', flight: 0.5 },
  { id: 'near', word: 'nebula', flight: 0.8 },
];

describe('the next Word bullet', () => {
  test('with nothing typed it is the nearest one', () => {
    expect(nextWordId({ wordBullets: bullets, typedWord: '' })).toBe('near');
  });

  test('while typing the nearest, it is the one after it', () => {
    expect(nextWordId({ wordBullets: bullets, typedWord: 'neb' })).toBe('mid');
  });

  test('while typing a farther word, it is the nearest of the rest (even if nearer than the Target)', () => {
    expect(nextWordId({ wordBullets: bullets, typedWord: 'ro' })).toBe('near');
    expect(nextWordId({ wordBullets: bullets, typedWord: 'com' })).toBe('near');
  });

  test('a Typed word that fits no Word bullet changes nothing', () => {
    expect(nextWordId({ wordBullets: bullets, typedWord: 'xyz' })).toBe('near');
  });

  test('two bullets with the same word: the nearer is the Target, the other one is next', () => {
    const twins = [{ id: 'a', word: 'star', flight: 0.3 }, { id: 'b', word: 'star', flight: 0.6 }];
    expect(nextWordId({ wordBullets: twins, typedWord: 'st' })).toBe('a');
  });

  test('nothing else on screen: none', () => {
    expect(nextWordId({ wordBullets: [bullets[2]], typedWord: 'ne' })).toBeNull();
    expect(nextWordId({ wordBullets: [], typedWord: '' })).toBeNull();
  });
});
