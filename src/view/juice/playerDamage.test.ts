import { describe, expect, test } from 'vitest';
import { DAMAGE_LEVELS, damageLevel, markedLevel, markConsole, trembleAmplitude } from './playerDamage';

const look = { tremble: 1, jolt: 0.05, joltSeconds: 0.7 };

describe('damage level', () => {
  test('is intact at 3 Lives, light at 2, bad at 1, and stays bad at 0 (the Lose ending takes over)', () => {
    expect(damageLevel(3)).toBe(0);
    expect(damageLevel(2)).toBe(1);
    expect(damageLevel(1)).toBe(2);
    expect(damageLevel(0)).toBe(2);
  });
});

describe('the mark when a Life goes', () => {
  test('comes when losing a Life raises the damage level, with the new level', () => {
    expect(markedLevel(3, 2)).toBe(1);
    expect(markedLevel(2, 1)).toBe(2);
    expect(markedLevel(3, 1)).toBe(2); // two at once: one mark
  });

  test('does not come for the last Life (no new level), with no change, or when Lives go back up', () => {
    expect(markedLevel(1, 0)).toBeNull();
    expect(markedLevel(2, 2)).toBeNull();
    expect(markedLevel(1, 3)).toBeNull();
  });

  test('bursts from the Lives console at the first damage and from the Radar console at the second', () => {
    expect(markConsole(1)).toBe('lives');
    expect(markConsole(2)).toBe('radar');
  });
});

describe('tremble of the structure around and below the Typed word panel', () => {
  test('is still when intact, light at 2 Lives, stronger at 1', () => {
    expect(trembleAmplitude(0, Infinity, look)).toBe(0);
    expect(trembleAmplitude(1, Infinity, look)).toBe(DAMAGE_LEVELS[1].tremble);
    expect(trembleAmplitude(2, Infinity, look)).toBe(DAMAGE_LEVELS[2].tremble);
    expect(DAMAGE_LEVELS[2].tremble).toBeGreaterThan(DAMAGE_LEVELS[1].tremble);
  });

  test('adds a hard jolt when the Life goes, fading out over the jolt time', () => {
    const steady = DAMAGE_LEVELS[2].tremble;
    expect(trembleAmplitude(2, 0, look)).toBeCloseTo(steady + 0.05);
    expect(trembleAmplitude(2, 0.35, look)).toBeCloseTo(steady + 0.05 * 0.25);
    expect(trembleAmplitude(2, 0.7, look)).toBeCloseTo(steady);
  });

  test('scales with the tremble knob', () => {
    expect(trembleAmplitude(2, Infinity, { ...look, tremble: 2 })).toBeCloseTo(DAMAGE_LEVELS[2].tremble * 2);
  });
});

describe('what each level breaks', () => {
  test('light damage: the Lives console only, two dead switches, a steady yellow warning', () => {
    const l = DAMAGE_LEVELS[1];
    expect(l.smokeFrom).toEqual(['lives']);
    expect(l.flicker).toEqual(['lives']);
    expect(l.deadSwitches).toEqual({ lives: [1, 3], radar: [] });
    expect(l.warning).toEqual({ text: 'HULL DAMAGED', color: 'yellow', blinkHz: 0 });
    expect(l.labelsStutter).toBe(false);
  });

  test('bad damage: both consoles, five dead switches, a blinking red warning, stuttering labels', () => {
    const l = DAMAGE_LEVELS[2];
    expect(l.smokeFrom).toEqual(['lives', 'radar']);
    expect(l.flicker).toEqual(['lives', 'radar']);
    expect(l.deadSwitches).toEqual({ lives: [1, 3], radar: [0, 2, 4] });
    expect(l.warning).toEqual({ text: '!! HULL CRITICAL !!', color: 'red', blinkHz: 1.5 });
    expect(l.labelsStutter).toBe(true);
  });

  test('bad damage smokes, spits sparks and glitches the Radar more often than light damage', () => {
    expect(DAMAGE_LEVELS[2].smokePerSecond).toBeGreaterThan(DAMAGE_LEVELS[1].smokePerSecond);
    expect(DAMAGE_LEVELS[2].sparkEvery[1]).toBeLessThan(DAMAGE_LEVELS[1].sparkEvery[0]);
    expect(DAMAGE_LEVELS[2].glitchEvery[1]).toBeLessThan(DAMAGE_LEVELS[1].glitchEvery[0]);
  });
});
