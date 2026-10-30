import { describe, expect, test } from 'vitest';
import { awayFrame, backFrame } from './linkFx';

const away = (t: number, secondsLeft = 10, losses = 1) => awayFrame(t, { secondsLeft, losses });
const times = (from: number, to: number, step = 0.02) => Array.from({ length: Math.round((to - from) / step) }, (_, i) => from + i * step);

describe('the reconnecting animation, while their signal is lost', () => {
  test('it opens with a glitch burst that dies away in half a second', () => {
    expect(away(0).glitch).toBeGreaterThan(0.4);
    expect(away(0.25).glitch).toBeLessThan(away(0).glitch);
    expect(away(0.5).glitch).toBe(0);
    expect(away(3).glitch).toBe(0);
  });

  test('the held words flicker out in the first 0.8 s, and stay hidden after that', () => {
    expect(away(0).wordsVisible).toBe(true);
    const flicker = times(0.1, 0.78).map((t) => away(t).wordsVisible);
    expect(flicker).toContain(true);
    expect(flicker).toContain(false);
    for (const t of times(0.8, 10)) expect(away(t).wordsVisible).toBe(false);
  });

  test('WEAK SIGNAL comes first, then ENEMY SIGNAL LOST', () => {
    expect(away(0.2).header.text).toBe('WEAK SIGNAL');
    expect(away(0.5).header.text).toBe('ENEMY SIGNAL LOST');
    expect(away(5).header.text).toBe('ENEMY SIGNAL LOST');
  });

  test('the ship flickers out more and more as the grace runs down, and is gone near the end', () => {
    const seen = (t: number, secondsLeft: number) => times(t, t + 1, 0.05).filter((x) => away(x, secondsLeft).enemyVisible).length;
    expect(seen(1, 9)).toBeGreaterThan(seen(8, 2));
    expect(away(9.9, 0.1).enemyVisible).toBe(false);
  });

  test('the RECONNECTING bar and the held-words note appear in turn, and the bar follows the seconds left', () => {
    expect(away(0.5).reconnecting).toBeNull();
    expect(away(0.8, 9).reconnecting).toEqual({ fraction: 0.9, seconds: 9 });
    expect(away(4, 6).reconnecting).toEqual({ fraction: 0.6, seconds: 6 });
    expect(away(1).heldNote).toBe(false);
    expect(away(1.2).heldNote).toBe(true);
  });

  test('the static spreads over the ship as the grace runs down', () => {
    expect(away(8, 2).staticDensity).toBeGreaterThan(away(1, 9).staticDensity);
    expect(away(0.1).slipChance).toBeGreaterThan(away(3).slipChance); // the rows jump hard at first, then settle
  });

  test('SIGNAL LOSS n OF 3 is always shown; from the 2nd it warns that one more ends it', () => {
    expect(away(2, 8, 1).lossLine).toEqual({ text: 'SIGNAL LOSS 1 OF 3', warn: false });
    expect(away(2, 8, 2).lossLine).toEqual({ text: 'SIGNAL LOSS 2 OF 3: ONE MORE AND THE OPPONENT IS CONSIDERED GONE', warn: true });
  });
});

describe('the back-countdown, once their signal returns', () => {
  test('the first 0.8 s only show ENEMY BACK with their held words, then the digits run 5 to 1', () => {
    const beat = backFrame(5.5);
    expect(beat).toMatchObject({ label: 'ENEMY BACK', digit: null, wordsVisible: true });
    expect(backFrame(5).digit).toBe(5);
    expect(backFrame(4.9).digit).toBe(5);
    expect(backFrame(4).digit).toBe(4);
    expect(backFrame(0.4).digit).toBe(1);
  });

  test('the digit turns red for the last 2 seconds', () => {
    expect(backFrame(3.1).urgent).toBe(false);
    expect(backFrame(2).urgent).toBe(true);
    expect(backFrame(0.5).urgent).toBe(true);
  });

  test('it reports how far into the current second it is, so the digit can pulse', () => {
    expect(backFrame(4.75).fraction).toBeCloseTo(0.25);
    expect(backFrame(4.0).fraction).toBeCloseTo(0);
  });
});
