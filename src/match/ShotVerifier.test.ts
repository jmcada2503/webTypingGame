import { beforeAll, describe, expect, test } from 'vitest';
import { loadWordList, type WordList } from '../words/wordLists';
import { pick } from './attackWords';
import { ShotVerifier, type AttackAudit } from './ShotVerifier';

const SEED = 0xc0ffee;
const LATENCY = 0.05; // one-way, seconds

let list: WordList;
beforeAll(async () => {
  list = await loadWordList('en');
});

function setup(options: Partial<ConstructorParameters<typeof ShotVerifier>[0]> = {}) {
  const audits: AttackAudit[] = [];
  const verifier = new ShotVerifier({ seed: SEED, list, oneWayLatency: () => LATENCY, report: (a) => audits.push(a), ...options });
  return { verifier, audits };
}

/** An honest opponent: fires Shot `i` at Match time `firedAt`; `t` is when it was picked (the previous Shot's fire time). */
const honestShot = (i: number, pickedAt: number) => ({ i, t: pickedAt, word: pick(SEED, i, pickedAt, list) });
const arrival = (firedAt: number) => firedAt + LATENCY;

describe('an honest opponent', () => {
  test('a run of Shots is accepted, with the first one picked at t = 0', () => {
    const { verifier, audits } = setup();
    const fired = [4.0, 9.5, 11.25, 30.0, 61.5];
    let pickedAt = 0;
    fired.forEach((firedAt, i) => {
      expect(verifier.verify(honestShot(i, pickedAt), arrival(firedAt))).toEqual({ ok: true });
      pickedAt = firedAt;
    });
    expect(audits).toEqual([]);
  });

  test('a Shot fired right after another is accepted', () => {
    const { verifier } = setup();
    expect(verifier.verify(honestShot(0, 0), arrival(5)).ok).toBe(true);
    expect(verifier.verify(honestShot(1, 5), arrival(5.25)).ok).toBe(true);
    expect(verifier.verify(honestShot(2, 5.25), arrival(5.5)).ok).toBe(true);
  });

  test('works without a latency estimate (it counts as 0)', () => {
    const { verifier } = setup({ oneWayLatency: undefined });
    expect(verifier.verify(honestShot(0, 0), 5).ok).toBe(true);
    expect(verifier.verify(honestShot(1, 5), 9).ok).toBe(true);
  });

  test('Rematch: with the same seed, the index continues and the first Shot is picked at t = 0 again', () => {
    const { verifier } = setup({ startIndex: 3 });
    expect(verifier.verify(honestShot(3, 0), arrival(6)).ok).toBe(true);
    expect(verifier.verify(honestShot(4, 6), arrival(10)).ok).toBe(true);
  });
});

describe('a cheating opponent', () => {
  test('firing an easy word instead of the picked one is ignored and logged', () => {
    const { verifier, audits } = setup();
    const result = verifier.verify({ i: 0, t: 0, word: 'to' }, arrival(3));
    expect(result).toEqual({ ok: false, reason: 'bad_word' });
    expect(audits).toEqual([expect.objectContaining({ kind: 'invalid_attack', reason: 'bad_word', i: 0, word: 'to' })]);
  });

  test('claiming an early t late in the Match to get the easy words is ignored', () => {
    const { verifier, audits } = setup();
    verifier.verify(honestShot(0, 0), arrival(100));
    // At minute 2 a cheater claims t = 0 so the picker hands out its easy start-of-Match words.
    const easy = pick(SEED, 1, 0, list);
    const result = verifier.verify({ i: 1, t: 0, word: easy }, arrival(130));
    expect(result).toEqual({ ok: false, reason: 'bad_time' });
    expect(audits).toEqual([expect.objectContaining({ kind: 'invalid_attack', reason: 'bad_time', i: 1 })]);
  });

  test('the first Shot must have t = 0', () => {
    const { verifier } = setup();
    expect(verifier.verify(honestShot(0, 40), arrival(50))).toEqual({ ok: false, reason: 'bad_time' });
  });

  test('skipping ahead in the sequence to pick an easy word is ignored; the next honest Shot still works', () => {
    const { verifier, audits } = setup();
    // The cheater scans ahead for an index whose word is short.
    let skip = 5;
    while (pick(SEED, skip, 20, list).length > 3) skip++;
    const result = verifier.verify({ i: skip, t: 20, word: pick(SEED, skip, 20, list) }, arrival(20));
    expect(result).toEqual({ ok: false, reason: 'bad_index' });
    expect(audits).toHaveLength(1);

    expect(verifier.verify(honestShot(0, 0), arrival(21)).ok).toBe(true);
  });

  test('sending a bad Shot does not let the cheater skip that word: the same index is still expected', () => {
    const { verifier } = setup();
    expect(verifier.verify({ i: 0, t: 0, word: 'zzz' }, arrival(2)).ok).toBe(false);
    expect(verifier.verify(honestShot(1, 2), arrival(3))).toEqual({ ok: false, reason: 'bad_index' });
    expect(verifier.verify(honestShot(0, 0), arrival(4)).ok).toBe(true);
  });

  test('a time that goes backwards between Shots is ignored', () => {
    const { verifier, audits } = setup();
    verifier.verify(honestShot(0, 0), arrival(10));
    // Shot 1 claims the latest t that is still within tolerance (expected 10.0); shot 2 arrives at the same
    // moment (expected 10.5) and claims the earliest t within tolerance, which is before shot 1's.
    expect(verifier.verify(honestShot(1, 10 + 0.9), arrival(10.5)).ok).toBe(true);
    const result = verifier.verify(honestShot(2, 10.5 - 0.9), arrival(10.5));
    expect(result).toEqual({ ok: false, reason: 'non_monotonic' });
    expect(audits.at(-1)).toMatchObject({ kind: 'invalid_attack', reason: 'non_monotonic', i: 2 });
  });

  test('a t further than the tolerance from the expected time is ignored, within it is accepted', () => {
    const inside = setup();
    inside.verifier.verify(honestShot(0, 0), arrival(10));
    expect(inside.verifier.verify(honestShot(1, 10 + 0.95), arrival(20)).ok).toBe(true);

    const outside = setup();
    outside.verifier.verify(honestShot(0, 0), arrival(10));
    expect(outside.verifier.verify(honestShot(1, 10 + 1.05), arrival(20))).toEqual({ ok: false, reason: 'bad_time' });
  });

  test('malformed Shots are ignored', () => {
    const { verifier } = setup();
    for (const bad of [
      { i: 0.5, t: 0, word: 'a' },
      { i: -1, t: 0, word: 'a' },
      { i: 0, t: Number.NaN, word: 'a' },
      { i: 0, t: Number.POSITIVE_INFINITY, word: 'a' },
      { i: 0, t: 0, word: 42 as unknown as string },
    ]) {
      expect(verifier.verify(bad, 1)).toEqual({ ok: false, reason: 'malformed' });
    }
  });
});

describe('repeats', () => {
  test('a Shot that was already accepted is ignored quietly (no invalid_attack)', () => {
    const { verifier, audits } = setup();
    verifier.verify(honestShot(0, 0), arrival(5));
    expect(verifier.verify(honestShot(0, 0), arrival(5.1))).toEqual({ ok: false, reason: 'duplicate' });
    expect(audits).toEqual([]);
    expect(verifier.verify(honestShot(1, 5), arrival(8)).ok).toBe(true);
  });

  test('after a Rematch starts, old indices count as repeats', () => {
    const { verifier } = setup({ startIndex: 3 });
    expect(verifier.verify(honestShot(2, 0), arrival(5))).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('near misses', () => {
  test('an accepted Shot close to the tolerance is logged so the tolerance can be tuned', () => {
    const { verifier, audits } = setup();
    verifier.verify(honestShot(0, 0), arrival(10));
    expect(verifier.verify(honestShot(1, 10 + 0.7), arrival(12)).ok).toBe(true);
    expect(audits).toEqual([expect.objectContaining({ kind: 'near_miss', i: 1, tolerance: 1 })]);
    expect((audits[0] as { deviation: number }).deviation).toBeCloseTo(0.7, 9);
  });

  test('a comfortable Shot is not logged', () => {
    const { verifier, audits } = setup();
    verifier.verify(honestShot(0, 0), arrival(10));
    verifier.verify(honestShot(1, 10 + 0.2), arrival(12));
    expect(audits).toEqual([]);
  });

  test('the tolerance can be changed', () => {
    const { verifier } = setup({ toleranceSeconds: 0.25 });
    verifier.verify(honestShot(0, 0), arrival(10));
    expect(verifier.verify(honestShot(1, 10 + 0.3), arrival(12))).toEqual({ ok: false, reason: 'bad_time' });
  });
});

test('audit entries are plain data (safe to log as JSON)', () => {
  const { verifier, audits } = setup();
  verifier.verify({ i: 0, t: 0, word: 'zzz' }, 3);
  expect(JSON.parse(JSON.stringify(audits))).toEqual(audits);
});
