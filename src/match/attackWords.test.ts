import { beforeAll, describe, expect, test } from 'vitest';
import { loadWordList, TIER_LENGTHS, TIERS, type Tier, type WordList } from '../words/wordLists';
import { createAttackWordSource, DIFFICULTY, difficulty, pick } from './attackWords';

let en: WordList;
let es: WordList;
beforeAll(async () => {
  [en, es] = await Promise.all([loadWordList('en'), loadWordList('es')]);
});

const tierOf = (word: string): Tier => TIERS.find((t) => [...word].length <= TIER_LENGTHS[t].max)!;
/** The tiers of the first `n` words of a seed at Match time `t`. */
const sampleTiers = (list: WordList, seed: number, t: number, n: number) =>
  Array.from({ length: n }, (_, i) => tierOf(pick(seed, i, t, list)));
const share = (tiers: Tier[], tier: Tier) => tiers.filter((x) => x === tier).length / tiers.length;

describe('pick', () => {
  test('same seed, index and time give the same word', () => {
    expect(pick(1234, 7, 42.5, en)).toBe(pick(1234, 7, 42.5, en));
    expect(pick(1234, 7, 42.5, es)).toBe(pick(1234, 7, 42.5, es));
  });

  test('is stateless: word i does not depend on which words were asked before', () => {
    const inOrder = Array.from({ length: 30 }, (_, i) => pick(99, i, 10, en));
    const backwards = Array.from({ length: 30 }, (_, k) => pick(99, 29 - k, 10, en)).reverse();
    expect(backwards).toEqual(inOrder);
  });

  test('different seeds give different sequences (each player has their own)', () => {
    const a = Array.from({ length: 40 }, (_, i) => pick(1, i, 0, en));
    const b = Array.from({ length: 40 }, (_, i) => pick(2, i, 0, en));
    expect(a).not.toEqual(b);
    expect(a.filter((w, i) => w === b[i]).length).toBeLessThan(5);
  });

  test('consecutive words differ', () => {
    const seq = Array.from({ length: 500 }, (_, i) => pick(5, i, 0, en));
    expect(new Set(seq).size).toBeGreaterThan(450);
  });

  test('always returns a word from the list, accents and ñ kept for Spanish', () => {
    const all = new Set(TIERS.flatMap((t) => es[t]));
    const seq = Array.from({ length: 2000 }, (_, i) => pick(77, i, 30, es));
    expect(seq.every((w) => all.has(w))).toBe(true);
    expect(seq.some((w) => /[áéíóúñ]/.test(w))).toBe(true);
  });

  test('seeds are treated as unsigned 32-bit numbers', () => {
    expect(pick(0xffffffff, 3, 0, en)).toBe(pick(-1, 3, 0, en));
    expect(pick(0, 0, 0, en)).toEqual(expect.any(String));
  });

  test('the time is taken to the millisecond, so a rounded t picks the same word', () => {
    expect(pick(8, 4, 12.3456, en)).toBe(pick(8, 4, 12.346, en));
  });
});

describe('pick is pinned', () => {
  // Both players' browsers must get exactly these words. If this test fails, the picker, the curve or a
  // word list changed: bump ATTACK_PICKER_VERSION and update the table on purpose, never to "fix" a red test.
  const inputs: [seed: number, i: number, t: number][] = [
    [0, 0, 0], [0, 1, 0], [0, 2, 30], [1, 0, 0], [1, 5, 90.5], [123456789, 3, 180], [123456789, 40, 600], [4294967295, 9, 12.345],
  ];
  const expected = {
    en: ['burn', 'rust', 'copy', 'pink', 'thirteen', 'ink', 'testing', 'tabs'],
    es: ['gol', 'pica', 'luna', 'pura', 'sarcasmo', 'coma', 'salen', 'mozo'],
  };

  test('English', () => expect(inputs.map(([s, i, t]) => pick(s, i, t, en))).toEqual(expected.en));
  test('Spanish', () => expect(inputs.map(([s, i, t]) => pick(s, i, t, es))).toEqual(expected.es));
});

describe('difficulty over Match time', () => {
  test('weights always add up to 1, at the start, in the middle and after the ramp', () => {
    for (const t of [0, 1, DIFFICULTY.rampSeconds / 2, DIFFICULTY.rampSeconds, 10_000]) {
      const w = difficulty(t);
      expect(w.short + w.medium + w.long).toBeCloseTo(1, 12);
    }
  });

  test('longer words get likelier as the Match goes on, and stay put after the ramp', () => {
    expect(difficulty(DIFFICULTY.rampSeconds / 2).long).toBeGreaterThan(difficulty(0).long);
    expect(difficulty(DIFFICULTY.rampSeconds).long).toBeGreaterThan(difficulty(DIFFICULTY.rampSeconds / 2).long);
    expect(difficulty(DIFFICULTY.rampSeconds * 5)).toEqual(difficulty(DIFFICULTY.rampSeconds));
    expect(difficulty(-3)).toEqual(difficulty(0));
  });

  test('short words stay possible and long words are possible from the start', () => {
    expect(difficulty(10_000).short).toBeGreaterThanOrEqual(0.1);
    expect(difficulty(0).long).toBeGreaterThan(0);
  });

  test('a real sequence follows the weights: early Match mostly short, late Match mostly long', () => {
    const early = sampleTiers(en, 3, 0, 4000);
    const late = sampleTiers(en, 3, DIFFICULTY.rampSeconds, 4000);
    expect(share(early, 'short')).toBeCloseTo(DIFFICULTY.start.short, 1);
    expect(share(early, 'long')).toBeCloseTo(DIFFICULTY.start.long, 1);
    expect(share(late, 'long')).toBeCloseTo(DIFFICULTY.end.long, 1);
    expect(share(late, 'short')).toBeGreaterThan(0.05);
    expect(share(late, 'long')).toBeGreaterThan(share(early, 'long') * 3);
  });
});

describe('createAttackWordSource', () => {
  test('wordAt(i, t) is pick(seed, i, t) over the list', () => {
    const source = createAttackWordSource(2024, es);
    expect(source.wordAt(0, 0)).toBe(pick(2024, 0, 0, es));
    expect(source.wordAt(9, 61.25)).toBe(pick(2024, 9, 61.25, es));
  });

  test('refuses a list with an empty tier', () => {
    expect(() => createAttackWordSource(1, { short: ['a'], medium: [], long: ['b'] })).toThrow(/medium/);
  });
});
