import { beforeAll, describe, expect, test } from 'vitest';
import { loadWordList, TIER_LENGTHS, TIERS, type Tier, type WordList } from '../words/wordLists';
import { PRACTICE_RAMP, PracticeDirector, rampAt, type Spawn } from './PracticeDirector';

let en: WordList;
let es: WordList;
beforeAll(async () => {
  [en, es] = await Promise.all([loadWordList('en'), loadWordList('es')]);
});

/** A fixed "random": always the middle, so spawn gaps are exactly the ramp's interval (no jitter). */
const middle = () => 0.5;
/** A small seeded random for reproducible runs. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const tierOf = (word: string): Tier => TIERS.find((t) => [...word].length <= TIER_LENGTHS[t].max)!;

/** Runs the director for `seconds` in 1/16 s steps, returning every spawn with the time it happened. */
function run(director: PracticeDirector, seconds: number, from = 0) {
  const out: { t: number; spawn: Spawn }[] = [];
  const dt = 1 / 16;
  for (let t = from; t < from + seconds - 1e-9; t += dt) {
    for (const spawn of director.advance(dt, [])) out.push({ t: t + dt, spawn });
  }
  return out;
}

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

describe('spawning', () => {
  test('nothing for the first moments, then the first word', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    const spawns = run(d, 6);
    expect(spawns.length).toBeGreaterThan(0);
    expect(spawns[0].t).toBeGreaterThan(1);
    expect(spawns[0].t).toBeLessThanOrEqual(PRACTICE_RAMP.firstSpawnAt + 0.1);
  });

  test('words keep coming at the ramp interval, which gets shorter', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    const spawns = run(d, 200);
    const gaps = spawns.slice(1).map((s, k) => s.t - spawns[k].t);
    expect(gaps[0]).toBeCloseTo(rampAt(PRACTICE_RAMP.firstSpawnAt).spawnEvery, 0);
    expect(gaps.at(-1)!).toBeLessThan(gaps[0]);
  });

  test('later words fly faster', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    const spawns = run(d, 400);
    expect(spawns.at(-1)!.spawn.flightSeconds).toBeLessThan(spawns[0].spawn.flightSeconds);
    expect(spawns[0].spawn.flightSeconds).toBeCloseTo(PRACTICE_RAMP.start.flightSeconds, 0);
  });

  test('the gap between words varies a little around the interval', () => {
    const d = new PracticeDirector({ list: en, random: lcg(7) });
    const gaps = run(d, 40).map((s, k, all) => (k ? s.t - all[k - 1].t : 0)).slice(1);
    expect(new Set(gaps.map((g) => g.toFixed(2))).size).toBeGreaterThan(3);
    const every = rampAt(10).spawnEvery;
    for (const g of gaps) {
      expect(g).toBeGreaterThan(every * 0.6);
      expect(g).toBeLessThan(every * 1.5);
    }
  });

  test('a long pause between calls still spawns every word that was due', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    const spawns = d.advance(30, []);
    expect(spawns.length).toBeGreaterThan(5);
  });

  test('does nothing for a zero or negative dt', () => {
    const d = new PracticeDirector({ list: en, random: middle });
    expect(d.advance(0, [])).toEqual([]);
    expect(d.advance(-1, [])).toEqual([]);
  });
});

describe('words', () => {
  test('come from the list, with accents and ñ kept for Spanish', () => {
    const all = new Set(TIERS.flatMap((t) => es[t]));
    const d = new PracticeDirector({ list: es, random: lcg(3) });
    const words = run(d, 900).map((s) => s.spawn.word);
    expect(words.length).toBeGreaterThan(200);
    expect(words.every((w) => all.has(w))).toBe(true);
    expect(words.some((w) => /[áéíóúñ]/.test(w))).toBe(true);
  });

  test('start short and get longer', () => {
    // The first minute of many runs, so the shares are not left to a handful of words.
    const early = Array.from({ length: 30 }, (_, k) => run(new PracticeDirector({ list: en, random: lcg(k + 1) }), 60)).flat();
    const d = new PracticeDirector({ list: en, random: lcg(2) });
    d.advance(PRACTICE_RAMP.rampSeconds, []); // jump to the end of the ramp
    const late = run(d, 600, PRACTICE_RAMP.rampSeconds);
    const share = (xs: { spawn: Spawn }[], tier: Tier) => xs.filter((x) => tierOf(x.spawn.word) === tier).length / xs.length;
    expect(share(early, 'short')).toBeGreaterThan(share(late, 'short'));
    expect(share(late, 'long')).toBeGreaterThan(share(early, 'long') * 3);
  });

  test('never repeat a word that is already flying', () => {
    const tiny: WordList = { short: ['aa', 'bb'], medium: ['ccccc', 'ddddd'], long: ['eeeeeeee', 'ffffffff'] };
    const d = new PracticeDirector({ list: tiny, random: lcg(11) });
    const flying = ['aa', 'ccccc', 'eeeeeeee'];
    for (let k = 0; k < 60; k++) {
      for (const s of d.advance(5, flying)) expect(flying).not.toContain(s.word);
    }
  });

  test('still spawn something when every word of a tiny list is flying', () => {
    const one: WordList = { short: ['aa'], medium: ['bbbbb'], long: ['cccccccc'] };
    const d = new PracticeDirector({ list: one, random: middle });
    expect(d.advance(10, ['aa', 'bbbbb', 'cccccccc']).length).toBeGreaterThan(0);
  });

  test('are reproducible with the same random', () => {
    const a = run(new PracticeDirector({ list: en, random: lcg(99) }), 120).map((s) => [s.t, s.spawn.word]);
    const b = run(new PracticeDirector({ list: en, random: lcg(99) }), 120).map((s) => [s.t, s.spawn.word]);
    expect(a).toEqual(b);
  });

  test('refuse a list with an empty tier', () => {
    expect(() => new PracticeDirector({ list: { short: ['a'], medium: [], long: ['b'] } })).toThrow(/medium/);
  });
});
