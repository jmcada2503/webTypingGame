import { beforeAll, describe, expect, test } from 'vitest';
import { loadWordList, TIER_LENGTHS, TIERS, type Tier, type WordList } from '../words/wordLists';
import {
  demandAt,
  meanLengths,
  PRACTICE_ACCELERATION,
  PRACTICE_CALIBRATION,
  PRACTICE_PLACEMENT,
  PRACTICE_RAMP,
  PracticeDirector,
  rampAt,
  startLevelFor,
  type Spawn,
} from './PracticeDirector';

let en: WordList;
let es: WordList;
beforeAll(async () => {
  [en, es] = await Promise.all([loadWordList('en'), loadWordList('es')]);
});

/** A fixed "random": always the middle, so spawn gaps are exactly the interval (no jitter). */
const middle = () => 0.5;
/** A small seeded random for reproducible runs. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const tierOf = (word: string): Tier => TIERS.find((t) => [...word].length <= TIER_LENGTHS[t].max)!;

/** A director that has already been placed (calibration done) for a player of the given pace, at time 0. */
function placed(list: WordList, pace: number, random: () => number = middle) {
  const d = new PracticeDirector({ list, random });
  d.finishCalibration(pace);
  return d;
}

/** A screen that is never empty: something is always flying, so the ramp does not speed up. */
const BUSY = ['on-screen'];

/**
 * Runs the director for `seconds` in 1/16 s steps, returning every spawn with the time it happened.
 * `onScreen` is what the player has on screen the whole time (default: always something).
 */
function run(director: PracticeDirector, seconds: number, from = 0, onScreen: readonly string[] = BUSY) {
  const out: { t: number; spawn: Spawn }[] = [];
  const dt = 1 / 16;
  for (let t = from; t < from + seconds - 1e-9; t += dt) {
    for (const spawn of director.advance(dt, onScreen)) out.push({ t: t + dt, spawn });
  }
  return out;
}
const gapsOf = (spawns: { t: number }[]) => spawns.slice(1).map((s, k) => s.t - spawns[k].t);

/**
 * Runs the director with a real screen: each word stays until the player clears it, `typeSeconds` after it
 * appears (or until it arrives, `flightSeconds` after it appears). Returns the spawns and the most words
 * that were ever on screen at once.
 */
function playWithScreen(director: PracticeDirector, seconds: number, typeSeconds: number, random?: never) {
  void random;
  const dt = 1 / 16;
  const screen: { word: string; leaves: number }[] = [];
  const spawns: { t: number; spawn: Spawn }[] = [];
  let mostOnScreen = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    for (let k = screen.length - 1; k >= 0; k--) if (screen[k].leaves <= t + 1e-9) screen.splice(k, 1);
    for (const spawn of director.advance(dt, screen.map((s) => s.word))) {
      spawns.push({ t: t + dt, spawn });
      screen.push({ word: spawn.word, leaves: t + dt + Math.min(typeSeconds, spawn.flightSeconds) });
    }
    mostOnScreen = Math.max(mostOnScreen, screen.length);
  }
  return { spawns, mostOnScreen };
}
/** Slack for the 1/16 s steps. */
const near = (actual: number, expected: number) => Math.abs(actual - expected) <= 0.15;

describe('the ramp', () => {
  test('gets harder with time: words come faster, fly faster and get longer', () => {
    const early = rampAt(0);
    const mid = rampAt(PRACTICE_RAMP.rampSeconds / 2);
    const late = rampAt(PRACTICE_RAMP.rampSeconds);
    expect(mid.spawnEvery).toBeLessThan(early.spawnEvery);
    expect(late.spawnEvery).toBeLessThan(mid.spawnEvery);
    expect(mid.flightSeconds).toBeLessThan(early.flightSeconds);
    expect(late.flightSeconds).toBeLessThan(mid.flightSeconds);
    expect(mid.weights.long).toBeGreaterThan(early.weights.long);
    expect(late.weights.long).toBeGreaterThan(mid.weights.long);
  });

  test('stops getting harder after the ramp, and negative time counts as the start', () => {
    expect(rampAt(PRACTICE_RAMP.rampSeconds * 4)).toEqual(rampAt(PRACTICE_RAMP.rampSeconds));
    expect(rampAt(-5)).toEqual(rampAt(0));
  });

  test('tier chances always add up to 1, and every tier stays possible', () => {
    for (const t of [0, 60, PRACTICE_RAMP.rampSeconds, 5000]) {
      const w = rampAt(t).weights;
      expect(w.short + w.medium + w.long).toBeCloseTo(1, 12);
      expect(Math.min(w.short, w.medium, w.long)).toBeGreaterThan(0);
    }
  });

  test('is never impossible: the end of the ramp still leaves time to type a word', () => {
    const end = rampAt(PRACTICE_RAMP.rampSeconds);
    expect(end.flightSeconds).toBeGreaterThanOrEqual(4);
    expect(end.spawnEvery).toBeGreaterThanOrEqual(0.8);
  });
});

describe('spawning after the player is placed', () => {
  test('nothing for the first moments, then the first word', () => {
    const spawns = run(placed(en, 0), 6);
    expect(spawns.length).toBeGreaterThan(0);
    expect(spawns[0].t).toBeGreaterThan(1);
    expect(spawns[0].t).toBeLessThanOrEqual(PRACTICE_RAMP.firstSpawnAt + 0.1);
  });

  test('words keep coming at the ramp interval, which gets shorter', () => {
    const gaps = gapsOf(run(placed(en, 0), 200));
    expect(gaps[0]).toBeCloseTo(rampAt(PRACTICE_RAMP.firstSpawnAt).spawnEvery, 0);
    expect(gaps.at(-1)!).toBeLessThan(gaps[0]);
  });

  test('later words fly faster', () => {
    const spawns = run(placed(en, 0), 400);
    expect(spawns.at(-1)!.spawn.flightSeconds).toBeLessThan(spawns[0].spawn.flightSeconds);
    expect(spawns[0].spawn.flightSeconds).toBeCloseTo(PRACTICE_RAMP.start.flightSeconds, 0);
  });

  test('the gap between words varies a little around the interval', () => {
    const gaps = gapsOf(run(placed(en, 0, lcg(7)), 40));
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(3);
    const every = rampAt(10).spawnEvery;
    for (const g of gaps) {
      expect(g).toBeGreaterThan(every * 0.6);
      expect(g).toBeLessThan(every * 1.5);
    }
  });

  test('a long pause between calls still spawns every word that was due', () => {
    expect(placed(en, 0).advance(30, []).length).toBeGreaterThan(5);
  });

  test('does nothing for a zero or negative dt', () => {
    const d = placed(en, 0);
    expect(d.advance(0, [])).toEqual([]);
    expect(d.advance(-1, [])).toEqual([]);
  });
});

describe('calibration: the first words', () => {
  test('a new run starts calibrating, with no level yet', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    expect(d.phase).toBe('calibrating');
    expect(d.startLevel).toBeNull();
  });

  test('the first word comes at the usual time, at the calibration flight time', () => {
    const { spawns } = playWithScreen(new PracticeDirector({ list: en, random: middle }), 5, 2);
    expect(near(spawns[0].t, PRACTICE_RAMP.firstSpawnAt)).toBe(true);
    expect(spawns[0].spawn.flightSeconds).toBe(PRACTICE_CALIBRATION.flightSeconds);
  });

  test('is self-paced: the next word comes a short gap after the screen is cleared', () => {
    const { spawns } = playWithScreen(new PracticeDirector({ list: en, random: middle }), 60, 2);
    expect(spawns.length).toBeGreaterThan(10);
    for (const g of gapsOf(spawns)) expect(near(g, 2 + PRACTICE_CALIBRATION.gap)).toBe(true);
  });

  test('never has two words on screen, however slow the player is: the pace follows the player', () => {
    for (const typeSeconds of [0.3, 2, 6, 9]) {
      const { spawns, mostOnScreen } = playWithScreen(new PracticeDirector({ list: en, random: middle }), 120, typeSeconds);
      expect(mostOnScreen).toBe(1);
      for (const g of gapsOf(spawns)) expect(near(g, typeSeconds + PRACTICE_CALIBRATION.gap)).toBe(true);
    }
  });

  test('a player who never types still gets the next word, once the last one has arrived', () => {
    const { spawns, mostOnScreen } = playWithScreen(new PracticeDirector({ list: en, random: middle }), 60, Number.POSITIVE_INFINITY);
    expect(mostOnScreen).toBe(1);
    expect(spawns.length).toBeGreaterThanOrEqual(4);
    for (const g of gapsOf(spawns)) expect(near(g, PRACTICE_CALIBRATION.flightSeconds + PRACTICE_CALIBRATION.gap)).toBe(true);
  });

  test('keeps waiting while a word is still on screen', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    d.advance(2, []); // the first word comes out
    expect(d.advance(60, ['still-here'])).toEqual([]);
  });

  test('stays in calibration until told otherwise', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    playWithScreen(d, 60, 1);
    expect(d.phase).toBe('calibrating');
    expect(d.startLevel).toBeNull();
  });

  test('uses a mix of short, medium and long words, so the measured speed is not about one length', () => {
    const words = Array.from({ length: 10 }, (_, k) => playWithScreen(new PracticeDirector({ list: en, random: lcg(k + 1) }), 90, 1).spawns).flat();
    const tiers = new Set(words.map((w) => tierOf(w.spawn.word)));
    expect([...tiers].sort()).toEqual([...TIERS].sort());
  });
});

describe('placing the player', () => {
  const lengths = () => meanLengths(en);

  test('mean word length per tier comes from the list', () => {
    const m = meanLengths(en);
    for (const tier of TIERS) {
      expect(m[tier]).toBeGreaterThanOrEqual(TIER_LENGTHS[tier].min);
      expect(m[tier]).toBeLessThanOrEqual(TIER_LENGTHS[tier].max);
    }
    expect(meanLengths({ short: ['ab', 'abcd'], medium: ['abcdef'], long: ['abcdefgh'] })).toEqual({ short: 3, medium: 6, long: 8 });
  });

  test('what the ramp asks of the player (letters per second) goes up with time', () => {
    const m = lengths();
    let last = 0;
    for (const t of [0, 60, 120, 240, 360, PRACTICE_RAMP.rampSeconds]) {
      const d = demandAt(t, m);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });

  test('a slow player starts at the beginning', () => {
    expect(startLevelFor(0, en)).toBe(0);
    expect(startLevelFor(0.5, en)).toBe(0);
  });

  test('a faster player starts further in, and a very fast one is capped at the end of the ramp', () => {
    const levels = [1.5, 2.5, 3.5, 5, 7, 10].map((pace) => startLevelFor(pace, en));
    for (let k = 1; k < levels.length; k++) expect(levels[k]).toBeGreaterThanOrEqual(levels[k - 1]);
    expect(levels[2]).toBeGreaterThan(levels[0]);
    expect(startLevelFor(1000, en)).toBe(PRACTICE_RAMP.rampSeconds);
    for (const l of levels) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(PRACTICE_RAMP.rampSeconds);
    }
  });

  test('the level asks for the placement share of the player\'s Pace, no more', () => {
    const pace = 3;
    const level = startLevelFor(pace, en);
    const target = pace * PRACTICE_PLACEMENT.share;
    expect(demandAt(level, lengths())).toBeGreaterThanOrEqual(target);
    expect(demandAt(level - 1, lengths())).toBeLessThan(target);
  });

  test('finishing calibration moves to the ramp and returns the level', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    run(d, 12);
    expect(d.finishCalibration(3)).toBe(startLevelFor(3, en));
    expect(d.phase).toBe('ramp');
    expect(d.startLevel).toBe(startLevelFor(3, en));
  });

  test('a bad Pace counts as the slowest player', () => {
    for (const pace of [Number.NaN, -4, Number.NEGATIVE_INFINITY]) {
      const d = new PracticeDirector({ list: en, random: middle });
      expect(d.finishCalibration(pace)).toBe(0);
    }
  });

  test('after being placed, a faster player gets faster, shorter-gapped words than a slower one', () => {
    const slow = run(placed(en, 1), 60);
    const fast = run(placed(en, 6), 60);
    expect(fast.length).toBeGreaterThan(slow.length);
    expect(fast[0].spawn.flightSeconds).toBeLessThan(slow[0].spawn.flightSeconds);
  });

  test('the ramp keeps rising from the level the player was placed at', () => {
    const level = startLevelFor(3, en);
    const spawns = run(placed(en, 3), 60);
    expect(spawns[0].spawn.flightSeconds).toBeCloseTo(rampAt(level + PRACTICE_RAMP.firstSpawnAt).flightSeconds, 1);
    expect(spawns.at(-1)!.spawn.flightSeconds).toBeLessThan(spawns[0].spawn.flightSeconds);
  });

  test('the first word at the new level does not come at once: it comes firstSpawnAt after placement', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    d.advance(2, []); // the first calibration word comes out
    d.advance(0.5, []); // the player has just cleared the screen: the next calibration word is a moment away
    d.finishCalibration(3);
    expect(d.advance(1.4, [])).toEqual([]);
    const spawns = d.advance(0.2, []);
    expect(spawns).toHaveLength(1);
    expect(spawns[0].flightSeconds).toBeLessThan(PRACTICE_CALIBRATION.flightSeconds);
  });

  test('works for Spanish too', () => {
    expect(startLevelFor(3, es)).toBeGreaterThan(0);
    expect(startLevelFor(3, es)).toBeLessThanOrEqual(PRACTICE_RAMP.rampSeconds);
  });
});

describe('acceleration while the screen is empty', () => {
  const rate = PRACTICE_ACCELERATION.emptyScreenRate;

  test('there is a real speed-up to test', () => {
    expect(rate).toBeGreaterThan(1);
  });

  test('the ramp clock starts at the placement level and runs in step with time while the screen is busy', () => {
    const d = placed(en, 3);
    const level = d.startLevel!;
    expect(d.rampTime).toBe(level);
    d.advance(10, BUSY);
    expect(d.rampTime).toBeCloseTo(level + 10, 9);
  });

  test('it runs faster while no Word bullet is on screen, by the emptyScreenRate', () => {
    const d = placed(en, 3);
    const level = d.startLevel!;
    d.advance(10, []);
    expect(d.rampTime).toBeCloseTo(level + 10 * rate, 9);
    d.advance(10, BUSY);
    expect(d.rampTime).toBeCloseTo(level + 10 * rate + 10, 9);
  });

  test('the speed-up follows how long the screen is empty: only the empty seconds count extra', () => {
    const d = placed(en, 3);
    const level = d.startLevel!;
    for (let k = 0; k < 20; k++) d.advance(1, k % 2 === 0 ? [] : BUSY); // 10 s empty, 10 s busy
    expect(d.rampTime).toBeCloseTo(level + 10 * rate + 10, 9);
  });

  test('the level shown never goes past the end of the ramp', () => {
    const d = placed(en, 1000);
    d.advance(100, []);
    expect(d.rampTime).toBe(PRACTICE_RAMP.rampSeconds);
  });

  test('an empty screen makes later words come faster and fly faster than a busy one does', () => {
    const busy = run(placed(en, 1), 90, 0, BUSY);
    const empty = run(placed(en, 1), 90, 0, []);
    expect(empty.length).toBeGreaterThan(busy.length);
    expect(empty.at(-1)!.spawn.flightSeconds).toBeLessThan(busy.at(-1)!.spawn.flightSeconds);
  });

  test('a word fired during an empty stretch is at the harder level that stretch reached', () => {
    const d = placed(en, 1); // level 0
    const spawns = run(d, 30, 0, []);
    const last = spawns.at(-1)!;
    // Ramp time at that spawn: about `rate` times the seconds since placement (less the small first delay)
    expect(last.spawn.flightSeconds).toBeCloseTo(rampAt(last.t * rate).flightSeconds, 0);
    expect(last.spawn.flightSeconds).toBeLessThan(rampAt(last.t).flightSeconds);
  });

  test('it does not apply during calibration: there is no level to climb yet', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    playWithScreen(d, 30, 0.5); // a fast player: the screen is empty most of the time
    expect(d.rampTime).toBeNull();
  });
});

describe('words', () => {
  test('come from the list, with accents and ñ kept for Spanish', () => {
    const all = new Set(TIERS.flatMap((t) => es[t]));
    const words = run(placed(es, 3, lcg(3)), 900).map((s) => s.spawn.word);
    expect(words.length).toBeGreaterThan(200);
    expect(words.every((w) => all.has(w))).toBe(true);
    expect(words.some((w) => /[áéíóúñ]/.test(w))).toBe(true);
  });

  test('start short and get longer', () => {
    // The first minute of many runs, so the shares are not left to a handful of words.
    const early = Array.from({ length: 30 }, (_, k) => run(placed(en, 0, lcg(k + 1)), 60)).flat();
    const late = run(placed(en, 1000, lcg(2)), 600); // placed at the end of the ramp
    const share = (xs: { spawn: Spawn }[], tier: Tier) => xs.filter((x) => tierOf(x.spawn.word) === tier).length / xs.length;
    expect(share(early, 'short')).toBeGreaterThan(share(late, 'short'));
    expect(share(late, 'long')).toBeGreaterThan(share(early, 'long') * 3);
  });

  test('never repeat a word that is already flying', () => {
    const tiny: WordList = { short: ['aa', 'bb'], medium: ['ccccc', 'ddddd'], long: ['eeeeeeee', 'ffffffff'] };
    const d = placed(tiny, 0, lcg(11));
    const flying = ['aa', 'ccccc', 'eeeeeeee'];
    for (let k = 0; k < 60; k++) {
      for (const s of d.advance(1, flying)) expect(flying).not.toContain(s.word);
    }
  });

  test('still spawn something when every word of a tiny list is flying', () => {
    const one: WordList = { short: ['aa'], medium: ['bbbbb'], long: ['cccccccc'] };
    expect(placed(one, 0).advance(10, ['aa', 'bbbbb', 'cccccccc']).length).toBeGreaterThan(0);
  });

  test('are reproducible with the same random', () => {
    const a = run(placed(en, 2, lcg(99)), 120).map((s) => [s.t, s.spawn.word]);
    const b = run(placed(en, 2, lcg(99)), 120).map((s) => [s.t, s.spawn.word]);
    expect(a).toEqual(b);
  });

  test('refuse a list with an empty tier', () => {
    expect(() => new PracticeDirector({ list: { short: ['a'], medium: [], long: ['b'] } })).toThrow(/medium/);
  });
});
