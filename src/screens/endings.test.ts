import { describe, expect, test } from 'vitest';
import { ENDINGS, endingFrame, endingMoments, rematchClockStart } from './endings';
import { GLITCH, TV_OFF_ON } from './ScreenTransition';

describe('ending timelines (seconds after the result is known)', () => {
  test('Win and Peace change screen with the glitch, Lose with the TV off / 1 s black / on', () => {
    expect(ENDINGS.won).toMatchObject({ effect: GLITCH, hold: 0, sceneSeconds: 1.6 });
    expect(ENDINGS.peace).toMatchObject({ effect: GLITCH, hold: 0, sceneSeconds: 4.6 });
    expect(ENDINGS.lost).toMatchObject({ effect: TV_OFF_ON, hold: 1, sceneSeconds: 5.2 });
  });

  test('at the start the scene is untouched', () => {
    for (const r of ['won', 'lost', 'peace'] as const) {
      expect(endingFrame(r, 0)).toEqual({ enemyVisible: true, enemyOffset: { x: 0, y: 0, z: 0 }, pace: null, paceScale: 1, dim: 0, shake: 0 });
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
  test('the stars slow to a stop from 0.3 s', () => {
    expect(endingFrame('lost', 0.3).paceScale).toBe(1);
    expect(endingFrame('lost', 0.9).paceScale).toBeCloseTo(0.5);
    expect(endingFrame('lost', 1.5).paceScale).toBeCloseTo(0);
    expect(endingFrame('lost', 5).paceScale).toBe(0);
  });

  test('the Enemy ship drifts closer and lower, then rushes up and over the player, and is gone behind them', () => {
    const at = (t: number) => endingFrame('lost', t);
    expect(at(2).enemyVisible).toBe(true);
    expect(at(3.2).enemyOffset.z).toBeGreaterThan(at(2).enemyOffset.z);
    expect(at(3.2).enemyOffset.y).toBeLessThan(at(2).enemyOffset.y);
    expect(at(4.3).enemyOffset.z).toBeGreaterThan(at(3.4).enemyOffset.z + 5); // the rush
    expect(at(4.3).enemyOffset.y).toBeGreaterThan(at(3.4).enemyOffset.y); // up and over
    expect(at(5.2).enemyVisible).toBe(false);
  });

  test('it gets dark and the cockpit rumbles, always within range, and nothing special explodes', () => {
    for (let t = 0; t <= 5.2; t += 0.1) {
      const f = endingFrame('lost', t);
      expect(f.dim).toBeGreaterThanOrEqual(0);
      expect(f.dim).toBeLessThanOrEqual(0.9);
      expect(f.shake).toBeGreaterThanOrEqual(0);
      expect(f.shake).toBeLessThanOrEqual(1);
    }
    expect(endingFrame('lost', 0.5).shake).toBe(0);
    expect(endingFrame('lost', 4).shake).toBeGreaterThan(endingFrame('lost', 1.5).shake);
    expect(endingFrame('lost', 3.4).dim).toBeGreaterThan(0.4);
    expect(endingMoments('lost', -1, 10)).toEqual([]);
  });
});

describe('the Rematch clock', () => {
  test('starts at the same moment for the winner and the loser: when the loser\'s end screen is up', () => {
    expect(rematchClockStart('won')).toBe(rematchClockStart('lost'));
    expect(rematchClockStart('lost')).toBeCloseTo(ENDINGS.lost.sceneSeconds + TV_OFF_ON.out);
  });

  test('a Peace ends for both at once, so it starts when its own end screen is up', () => {
    expect(rematchClockStart('peace')).toBeCloseTo(ENDINGS.peace.sceneSeconds + GLITCH.out);
  });
});

describe('Peace', () => {
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
