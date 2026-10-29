import { beforeAll, describe, expect, test } from 'vitest';
import { FakeTypingInput } from '../input/FakeTypingInput';
import { loadWordList, type WordList } from '../words/wordLists';
import { PracticeSession } from './PracticeSession';

let list: WordList;
beforeAll(async () => {
  list = await loadWordList('en');
});

const STEP = 1 / 16;

function practice(seed = 1) {
  let s = seed;
  const random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const input = new FakeTypingInput();
  const session = new PracticeSession({ list, random });
  session.attachInput(input);
  session.start();
  /** Advance in 1/16 s steps. With `defend`, the player destroys every Word bullet the moment it appears. */
  const play = (seconds: number, defend = false) => {
    for (let t = 0; t < seconds - 1e-9; t += STEP) {
      session.update(STEP);
      if (defend) session.state().wordBullets.forEach((b) => input.say(b.word));
    }
  };
  return { session, input, play };
}

describe('a Practice run', () => {
  test('is idle until started, then running', () => {
    const session = new PracticeSession({ list });
    expect(session.status).toBe('idle');
    session.start();
    expect(session.status).toBe('running');
  });

  test('has no Attack word and no opponent', () => {
    const { session, play } = practice();
    play(20, true);
    expect(session.state().attackWord).toBe('');
    expect(session.state().shots).toEqual([]);
  });

  test('Word bullets start coming on their own', () => {
    const { session, play } = practice();
    play(3);
    expect(session.state().wordBullets.length).toBeGreaterThan(0);
  });

  test('typing a Word bullet and submitting it destroys it', () => {
    const { session, input, play } = practice();
    play(3);
    const word = session.state().wordBullets[0].word;
    input.say(word);
    expect(session.state().wordBullets.map((b) => b.word)).not.toContain(word);
  });

  test('is endless while the player keeps up', () => {
    const { session, play } = practice();
    play(300, true);
    expect(session.status).toBe('running');
    expect(session.state().lives).toBe(3);
  });

  test('ends when the player is out of Lives, and nothing more spawns', () => {
    const { session, play } = practice();
    play(60); // the player never types
    expect(session.status).toBe('lost');
    expect(session.state().lives).toBe(0);
    const bullets = session.state().wordBullets.length;
    play(30);
    expect(session.state().wordBullets.length).toBeLessThanOrEqual(bullets);
  });

  test('stops reading the keyboard once it is over', () => {
    const { session, input, play } = practice();
    play(60);
    expect(session.status).toBe('lost');
    expect(input.enabled).toBe(false);
  });

  test('later Word bullets fly faster than the first ones', () => {
    const { session, input, play } = practice();
    /** Waits for a new Word bullet, then lets it fly for one second and says how far it got. */
    const flightAfterOneSecond = () => {
      session.state().wordBullets.forEach((b) => input.say(b.word)); // clear the screen first
      let id: string | undefined;
      for (let k = 0; k < 400 && !id; k++) {
        session.update(STEP);
        id = session.state().wordBullets[0]?.id;
      }
      play(1);
      return session.state().wordBullets.find((b) => b.id === id)!.flight;
    };

    const early = flightAfterOneSecond();
    play(300, true);
    const late = flightAfterOneSecond();

    expect(session.status).toBe('running');
    expect(late).toBeGreaterThan(early * 1.3);
  });
});

describe('the result', () => {
  test('counts time survived, words, letters and accuracy', () => {
    const { session, input, play } = practice();
    play(3);
    const first = session.state().wordBullets[0].word;
    input.say(first);
    input.say('zzzzzz'); // wrong
    play(10, true);
    const r = session.result();

    expect(r.survivedSeconds).toBeCloseTo(13, 1);
    expect(r.wordsTyped).toBeGreaterThanOrEqual(2);
    expect(r.lettersTyped).toBeGreaterThanOrEqual(first.length);
    expect(r.wrongSubmits).toBe(1);
    expect(r.accuracy).toBeCloseTo(r.wordsTyped / (r.wordsTyped + 1), 9);
  });

  test('has Pace as letters per second: the average over the run and the best moment', () => {
    const { session, play } = practice();
    play(60, true);
    const r = session.result();
    expect(r.averagePace).toBeCloseTo(r.lettersTyped / r.survivedSeconds, 9);
    expect(r.averagePace).toBeGreaterThan(0);
    expect(r.peakPace).toBeGreaterThanOrEqual(r.averagePace);
  });

  test('the best Pace is never below the average, even right after a single word', () => {
    const { session, input, play } = practice();
    play(3);
    input.say(session.state().wordBullets[0].word); // the live Pace is a smoothed window: still tiny
    play(0.25);
    const r = session.result();
    expect(r.averagePace).toBeGreaterThan(0.5);
    expect(r.peakPace).toBeGreaterThanOrEqual(r.averagePace);
  });

  test('has words per minute (5 letters = 1 word), from the average Pace', () => {
    const { session, play } = practice();
    play(60, true);
    const r = session.result();
    expect(r.wpm).toBeCloseTo((r.averagePace * 60) / 5, 9);
  });

  test('accuracy is null when nothing was submitted, and 1 when everything was right', () => {
    const none = practice();
    none.play(1);
    expect(none.session.result().accuracy).toBeNull();

    const perfect = practice();
    perfect.play(30, true);
    expect(perfect.session.result().accuracy).toBe(1);
  });

  test('stops changing once the run is over', () => {
    const { session, play } = practice();
    play(60);
    const before = session.result();
    play(30);
    expect(session.result()).toEqual(before);
    expect(before.survivedSeconds).toBeLessThan(60);
  });

  test('survived time is the time up to the last Life, not the time the session was kept running', () => {
    const { session, play } = practice();
    play(120);
    expect(session.status).toBe('lost');
    expect(session.result().survivedSeconds).toBeLessThan(40);
  });
});

describe('dispose', () => {
  test('stops listening to the keyboard', () => {
    const { session, input, play } = practice();
    play(3);
    session.dispose();
    const before = session.state().typedWord;
    input.type('abc');
    expect(session.state().typedWord).toBe(before);
  });
});
