import { describe, expect, test } from 'vitest';
import { NUDGE, nudgeLook, peaceLabel } from './attackNudge';

describe('the nudge look', () => {
  test('pops for a moment when it starts, then stops popping', () => {
    expect(nudgeLook(0, false).popping).toBe(true);
    expect(nudgeLook(NUDGE.popSeconds - 0.01, false).popping).toBe(true);
    expect(nudgeLook(NUDGE.popSeconds + 0.01, false).popping).toBe(false);
    expect(nudgeLook(NUDGE.popSeconds + 0.01, true).popping).toBe(false);
  });

  test('the pop takes the same time when the opponent is Idle too', () => {
    expect(nudgeLook(NUDGE.popSeconds - 0.01, true).popping).toBe(true);
  });

  test('the marker bobs up and down within its range', () => {
    const offsets = Array.from({ length: 200 }, (_, k) => nudgeLook(k * 0.02, false).markerOffset);
    expect(Math.max(...offsets)).toBeCloseTo(NUDGE.bobRows, 1);
    expect(Math.min(...offsets)).toBeCloseTo(-NUDGE.bobRows, 1);
  });

  test('the marker repeats every period, and a faster nudge has a shorter period', () => {
    const period = (2 * Math.PI) / NUDGE.bobSpeed;
    expect(nudgeLook(1.3 + period, false).markerOffset).toBeCloseTo(nudgeLook(1.3, false).markerOffset, 9);
    expect(nudgeLook(1.3 + period / NUDGE.fast, true).markerOffset).toBeCloseTo(nudgeLook(1.3, true).markerOffset, 9);
    expect(nudgeLook(1.3 + period / NUDGE.fast, false).markerOffset).not.toBeCloseTo(nudgeLook(1.3, false).markerOffset, 3);
  });

  test('the hint blinks slowly: on for 1/Hz seconds, then off for as long', () => {
    const step = 1 / NUDGE.hintHz;
    expect(nudgeLook(step * 0.5, false).hint).toBe(true);
    expect(nudgeLook(step * 1.5, false).hint).toBe(false);
    expect(nudgeLook(step * 2.5, false).hint).toBe(true);
  });

  test('the underline alternates, faster than the hint', () => {
    const step = 1 / NUDGE.underlineHz;
    expect(NUDGE.underlineHz).toBeGreaterThan(NUDGE.hintHz);
    expect(nudgeLook(step * 0.5, false).underlineLit).toBe(true);
    expect(nudgeLook(step * 1.5, false).underlineLit).toBe(false);
  });

  test('everything runs faster when the opponent is Idle too', () => {
    // Count how often the underline flips in 4 seconds.
    const cycles = (fast: boolean) => {
      let flips = 0;
      let last = nudgeLook(0, fast).underlineLit;
      for (let k = 1; k <= 400; k++) {
        const now = nudgeLook(k * 0.01, fast).underlineLit;
        if (now !== last) flips++;
        last = now;
      }
      return flips;
    };
    expect(cycles(true)).toBeGreaterThan(cycles(false) * 1.5);
  });
});

describe('the Peace label', () => {
  test('shows the whole seconds left, rounded up', () => {
    expect(peaceLabel(4)).toBe('PEACE IN 4');
    expect(peaceLabel(3.2)).toBe('PEACE IN 4');
    expect(peaceLabel(0.2)).toBe('PEACE IN 1');
  });

  test('says PEACE!! at zero', () => {
    expect(peaceLabel(0)).toBe('PEACE!!');
  });
});
