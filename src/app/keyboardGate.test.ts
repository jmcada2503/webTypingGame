import { describe, expect, test } from 'vitest';
import { isTouchOnly, type PointerEnv } from './keyboardGate';

const env = (touchPoints: number, queries: string[]): PointerEnv => ({
  matchMedia: (q) => ({ matches: queries.includes(q) }),
  navigator: { maxTouchPoints: touchPoints },
});

describe('isTouchOnly', () => {
  test('a phone or tablet (finger only) is blocked', () => {
    expect(isTouchOnly(env(5, ['(pointer: coarse)', '(any-pointer: coarse)']))).toBe(true);
  });

  test('a desktop (mouse, no touch) is not blocked', () => {
    expect(isTouchOnly(env(0, ['(pointer: fine)', '(any-pointer: fine)']))).toBe(false);
  });

  test('a touch laptop (touch screen plus trackpad) is not blocked, whichever pointer is primary', () => {
    expect(isTouchOnly(env(10, ['(pointer: fine)', '(any-pointer: fine)', '(any-pointer: coarse)']))).toBe(false);
    expect(isTouchOnly(env(10, ['(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)']))).toBe(false);
  });

  test('a tablet with a trackpad attached is not blocked', () => {
    expect(isTouchOnly(env(5, ['(pointer: coarse)', '(any-pointer: fine)']))).toBe(false);
  });
});
