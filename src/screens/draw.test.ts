import { describe, expect, test } from 'vitest';
import { formatClock, wrap } from './draw';

describe('wrap', () => {
  test('breaks text into lines of at most `width` characters, on word boundaries', () => {
    expect(wrap('THE MATCH STARTS AS SOON AS ANOTHER PLAYER IS LOOKING TOO', 20)).toEqual([
      'THE MATCH STARTS AS',
      'SOON AS ANOTHER',
      'PLAYER IS LOOKING',
      'TOO',
    ]);
  });

  test('keeps a word longer than the width on its own line', () => {
    expect(wrap('A ELECTROENCEFALOGRAMA B', 10)).toEqual(['A', 'ELECTROENCEFALOGRAMA', 'B']);
  });

  test('gives no lines for empty text', () => {
    expect(wrap('', 10)).toEqual([]);
  });
});

describe('formatClock', () => {
  test('shows minutes and seconds with two digits each', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(7.9)).toBe('00:07');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(600)).toBe('10:00');
  });
});
