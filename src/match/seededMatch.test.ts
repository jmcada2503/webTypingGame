import { beforeAll, describe, expect, test } from 'vitest';
import { loadWordList, type WordList } from '../words/wordLists';
import { createAttackWordSource, pick } from './attackWords';
import { MatchEngine } from './MatchEngine';
import { ShotVerifier, type AttackAudit } from './ShotVerifier';
import type { AttackWordSource, NetEvent } from './types';

const SEED_A = 111_111;
const SEED_B = 222_222;
const STEP = 0.25; // exact in binary

let list: WordList;
beforeAll(async () => {
  list = await loadWordList('es');
});

interface Options {
  /** Replaces A's Attack-word source: a modified client that picks its own words. */
  sourceA?: AttackWordSource;
  /** Rewrites what A puts on the wire: a modified client that lies in its messages. */
  tamperA?: (event: NetEvent) => NetEvent;
  /** Rematch: the index the Match continues from (same seeds). */
  startIndex?: number;
}

/**
 * Two engines playing each other with the seeded picker. Each one checks the other's Shots against the
 * other's seed (both seeds are known to both players). Events cross at the end of each step.
 */
function match(options: Options = {}) {
  const audits: AttackAudit[] = [];
  const startIndex = options.startIndex ?? 0;
  const report = (a: AttackAudit) => audits.push(a);
  const verifierOfA = new ShotVerifier({ seed: SEED_A, list, startIndex, report });
  const verifierOfB = new ShotVerifier({ seed: SEED_B, list, startIndex, report });
  const config = { mode: 'versus' as const, bulletFlightSeconds: 8, shotFlightSeconds: 8, startIndex };
  const a = new MatchEngine({
    ...config,
    attackWords: options.sourceA ?? createAttackWordSource(SEED_A, list),
    verifyShot: (shot, at) => verifierOfB.verify(shot, at).ok,
  });
  const b = new MatchEngine({
    ...config,
    attackWords: createAttackWordSource(SEED_B, list),
    verifyShot: (shot, at) => verifierOfA.verify(shot, at).ok,
  });
  const step = () => {
    a.typed(''); // both players keep typing a little, so the Match does not end in Peace
    b.typed('');
    a.update(STEP);
    b.update(STEP);
    for (const e of a.drainOutgoing()) b.receive(options.tamperA ? options.tamperA(e) : e);
    for (const e of b.drainOutgoing()) a.receive(e);
  };
  const wait = (seconds: number) => {
    for (let t = 0; t < seconds; t += STEP) step();
  };
  /** A types its Attack word; once the Shot has crossed, B destroys whatever Word bullets it has. */
  const fire = () => {
    a.submit(a.state().attackWord);
    wait(STEP);
    b.state().wordBullets.forEach((bullet) => b.submit(bullet.word));
  };
  return { a, b, audits, wait, fire };
}

const invalid = (audits: AttackAudit[]) => audits.filter((x) => x.kind === 'invalid_attack');

describe('two honest engines', () => {
  test("A's Shots reach B as the words the seed picks, from the start of the Match to minutes in", () => {
    const { a, b, audits, wait, fire } = match();
    const firstWord = a.state().attackWord;
    wait(3);
    fire();
    for (let n = 0; n < 5; n++) {
      wait(60); // the Match goes on, so the picker moves toward longer words
      fire();
    }
    expect(firstWord).toBe(pick(SEED_A, 0, 0, list));
    expect(a.stats().shotsFired).toBe(6);
    expect(b.stats().bulletsDestroyed).toBe(6);
    expect(a.stats().elapsed).toBeGreaterThan(300);
    expect(invalid(audits)).toEqual([]);
  });

  test('a Rematch continues from the same index and seed, with its first word picked at t = 0 again', () => {
    const { a, b, audits, wait, fire } = match({ startIndex: 7 });
    expect(a.state().attackWord).toBe(pick(SEED_A, 7, 0, list));
    wait(2);
    fire();
    wait(30);
    fire();
    expect(b.stats().bulletsDestroyed).toBe(2);
    expect(invalid(audits)).toEqual([]);
  });
});

describe('a cheating client', () => {
  test('firing easy words of its own choice never lands a Word bullet in the other game', () => {
    const { a, b, audits, wait } = match({ sourceA: { wordAt: () => 'si' } });
    for (let n = 0; n < 4; n++) {
      wait(5);
      a.submit('si');
    }
    wait(1);
    expect(a.stats().shotsFired).toBe(4); // it thinks it is attacking...
    expect(b.state().wordBullets).toEqual([]); // ...but B never got a bullet
    expect(b.state().lives).toBe(3);
    expect(invalid(audits)[0]).toMatchObject({ reason: 'bad_word', i: 0, word: 'si' });
  });

  test('claiming t = 0 late in the Match, to get the easy start-of-Match words, is ignored', () => {
    const lie = (e: NetEvent): NetEvent => (e.type === 'shot' && e.i === 2 ? { ...e, t: 0, word: pick(SEED_A, 2, 0, list) } : e);
    const { b, audits, wait, fire } = match({ tamperA: lie });
    wait(1);
    fire(); // shot 0
    wait(240);
    fire(); // shot 1, honest
    wait(240);
    fire(); // shot 2, with the lie

    expect(b.stats().bulletsDestroyed).toBe(2);
    expect(invalid(audits)).toEqual([expect.objectContaining({ reason: 'bad_time', i: 2 })]);
  });

  test('skipping ahead to an easy word is ignored', () => {
    let skip = 3;
    while (pick(SEED_A, skip, 10, list).length > 3) skip++;
    const jump = (e: NetEvent): NetEvent => (e.type === 'shot' && e.i === 1 ? { ...e, i: skip, t: 10, word: pick(SEED_A, skip, 10, list) } : e);
    const { b, audits, wait, fire } = match({ tamperA: jump });
    wait(1);
    fire(); // shot 0
    wait(9);
    fire(); // shot 1, rewritten to jump ahead

    expect(b.stats().bulletsDestroyed).toBe(1);
    expect(invalid(audits)).toEqual([expect.objectContaining({ reason: 'bad_index', i: skip })]);
  });
});
