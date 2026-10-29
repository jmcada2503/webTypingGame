import { describe, expect, test } from 'vitest';
import { ENDINGS, endingFrame, endingMoments } from './endings';
import { GLITCH, TV_OFF_ON } from './ScreenTransition';

describe('ending timelines (seconds after the result is known)', () => {
  test('Win and Peace change screen with the glitch, Lose with the TV off / 1 s black / on', () => {
    expect(ENDINGS.won).toMatchObject({ effect: GLITCH, hold: 0, sceneSeconds: 1.6 });
    expect(ENDINGS.peace).toMatchObject({ effect: GLITCH, hold: 0, sceneSeconds: 4.6 });
    expect(ENDINGS.lost).toMatchObject({ effect: TV_OFF_ON, hold: 1, sceneSeconds: 3.8 });
  });

  test('at the start Win and Lose leave the scene untouched (Peace already changes the labels)', () => {
    for (const r of ['won', 'lost'] as const) {
      expect(endingFrame(r, 0)).toEqual({ enemyVisible: true, enemyOffset: { x: 0, y: 0, z: 0 }, pace: null, paceScale: 1, dim: 0, peaceLabels: false });
    }
  });
});

describe('Win', () => {
  test('a bigger explosion and a shake go off right away, and the Enemy ship is gone after half a second', () => {
    expect(endingMoments('won', -0.01, 0.05)).toEqual(['enemyDestroyed']);
    expect(endingMoments('won', 0.05, 3)).toEqual([]);
    expect(endingFrame('won', 0.49).enemyVisible).toBe(true);
    expect(endingFrame('won', 0.5).enemyVisible).toBe(false);
    expect(endingFrame('won', 1.5).enemyVisible).toBe(false);
  });
});

describe('Lose', () => {
  test('the stars slow to a stop from 0.4 s and the lights dim slowly from 0.6 s, to 85%', () => {
    expect(endingFrame('lost', 0.4).paceScale).toBe(1);
    expect(endingFrame('lost', 0.9).paceScale).toBeCloseTo(0.5);
    expect(endingFrame('lost', 1.4).paceScale).toBeCloseTo(0);
    expect(endingFrame('lost', 5).paceScale).toBe(0);

    expect(endingFrame('lost', 0.6).dim).toBeCloseTo(0);
    expect(endingFrame('lost', 1.6).dim).toBeCloseTo(0.45);
    expect(endingFrame('lost', 3.8).dim).toBe(0.85);
  });

  test('the Enemy ship stays and nothing special explodes', () => {
    expect(endingFrame('lost', 2).enemyVisible).toBe(true);
    expect(endingMoments('lost', -1, 10)).toEqual([]);
  });
});

describe('Peace', () => {
  test('both labels turn to PEACE!! at once', () => {
    expect(endingFrame('peace', 0).peaceLabels).toBe(true);
    expect(endingFrame('peace', 3).peaceLabels).toBe(true);
  });

  test('the Enemy ship flies away from 0.8 s over 3 s, up, aside and far off, accelerating', () => {
    expect(endingFrame('peace', 0.8).enemyOffset).toEqual({ x: 0, y: 0, z: 0 });
    const mid = endingFrame('peace', 2.3).enemyOffset; // halfway: k = 0.5, eased to 0.25
    expect(mid.x).toBeCloseTo(7.5);
    expect(mid.y).toBeCloseTo(3);
    expect(mid.z).toBeCloseTo(-17.5);
    expect(endingFrame('peace', 3.8).enemyOffset).toEqual({ x: 30, y: 12, z: -70 });
    expect(endingFrame('peace', 10).enemyOffset).toEqual({ x: 30, y: 12, z: -70 });
  });

  test('the stars race past: Pace rises from 2 by 3 a second after 0.8 s, up to 9', () => {
    expect(endingFrame('peace', 0.8).pace).toBe(2);
    expect(endingFrame('peace', 1.8).pace).toBe(5);
    expect(endingFrame('peace', 4.6).pace).toBe(9);
  });
});
