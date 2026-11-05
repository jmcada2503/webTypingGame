import { describe, expect, test } from 'vitest';
import { FakeBackend } from '../flow/FakeNetwork';
import { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import type { PracticeResult } from '../practice/PracticeSession';
import type { TextGrid } from '../render/AsciiRenderer';
import type { SoundId } from '../audio/sounds';
import { practiceScore } from './content';
import { practiceEndScreen } from './practiceEndScreen';

type EndState = Extract<FlowState, { screen: 'end'; mode: 'practice' }>;
const END: EndState = { screen: 'end', mode: 'practice', result: 'practiceOver' };
const RUN: PracticeResult = { survivedSeconds: 95, activeSeconds: 90, wordsTyped: 60, lettersTyped: 320, wrongSubmits: 4, accuracy: 0.94, averagePace: 3.5, peakPace: 5, wpm: 42, calibrationPace: 3, startLevel: 10, currentLevel: 60 };
const FRAME = 1 / 60;

/** A `sessionStorage` stand-in, optionally holding a best score already. */
const storage = (best?: number) => {
  const data = new Map<string, string>(best === undefined ? [] : [['practice.best', String(best)]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

/** A text grid that keeps the big SCORE line. */
function recorder() {
  let score: string | null = null;
  const grid: TextGrid = { cols: 128, rows: 45, write() {}, fill() {}, clear() {}, writeScaled: (_c, _r, s) => void (s.startsWith('SCORE ') && (score = s)) };
  return { grid, score: () => score };
}

/** The game over screen for `run`, with the picture coming back from the TV effect `blackFor` seconds in. */
function gameOver(opts: { run?: PracticeResult; best?: number; blackFor?: number } = {}) {
  const sounds: { id: SoundId; t: number }[] = [];
  let t = 0;
  const blackFor = opts.blackFor ?? 0;
  const screen = practiceEndScreen(new ScreenFlow(new FakeBackend().connect()), () => opts.run ?? RUN, () => storage(opts.best), { play: (id) => sounds.push({ id, t }), pictureOn: () => t >= blackFor });
  const grid = recorder();
  screen.enter(END);
  /** Draw frames for `seconds`; returns the score shown last. */
  const run = (seconds: number) => {
    for (const end = t + seconds; t < end - 1e-9; t += FRAME) screen.draw(grid.grid, t, END);
    return grid.score();
  };
  return { run, sounds, ids: () => sounds.map((s) => s.id) };
}

const fmt = (n: number) => `SCORE ${n.toLocaleString('en-US')}`;

describe('Practice game over: the score count-up', () => {
  test('the score waits at 0 while the picture is still black, then counts up to the full score once it is back', () => {
    const g = gameOver({ blackFor: 0.8 });
    expect(g.run(0.8)).toBe(fmt(0));
    expect(g.run(0.3)).not.toBe(fmt(0));
    expect(g.run(1.5)).toBe(fmt(practiceScore(RUN)));
  });

  test('a tick plays as the number climbs, at most one every 0.07 s, and none after it stops', () => {
    const g = gameOver({ best: 1e9 }); // no NEW BEST, only ticks
    g.run(3);
    const ticks = g.sounds.filter((s) => s.id === 'scoreTick').map((s) => s.t);
    expect(ticks.length).toBeGreaterThanOrEqual(10);
    expect(ticks.every((t, i) => i === 0 || t - ticks[i - 1] >= 0.07 - 1e-9)).toBe(true);
    expect(Math.max(...ticks)).toBeLessThanOrEqual(1.2 + 0.07); // the last number gets its tick right after the count
  });

  test('NEW BEST plays once, after the count, only when the run beats the best', () => {
    const best = gameOver();
    best.run(3);
    expect(best.ids().filter((id) => id === 'newBest')).toHaveLength(1);
    expect(best.ids().at(-1)).toBe('newBest');
    const beaten = gameOver({ best: 1e9 });
    beaten.run(3);
    expect(beaten.ids()).not.toContain('newBest');
  });

  test('a score of 0 makes no sound', () => {
    const g = gameOver({ run: { ...RUN, currentLevel: null } });
    g.run(3);
    expect(g.ids()).toEqual([]);
  });
});
