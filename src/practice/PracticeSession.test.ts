import { beforeAll, describe, expect, test } from 'vitest';
import { FakeTypingInput } from '../input/FakeTypingInput';
import { loadWordList, type WordList } from '../words/wordLists';
import { PRACTICE_ACCELERATION, PRACTICE_CALIBRATION, PRACTICE_RAMP } from './PracticeDirector';
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
  /**
   * A typist: types each Word bullet `reaction + letters / lettersPerSecond` seconds after it appears.
   * `skip(n)` says whether to let the n-th bullet (from 0) through untouched.
   */
  const typist = (lettersPerSecond: number, skip: (n: number) => boolean = () => false, reaction = 0.4) => {
    const seen = new Map<string, { n: number; at: number }>();
    let now = 0;
    return (seconds: number) => {
      for (let t = 0; t < seconds - 1e-9; t += STEP) {
        session.update(STEP);
        now += STEP;
        for (const b of session.state().wordBullets) {
          if (!seen.has(b.id)) seen.set(b.id, { n: seen.size, at: now });
          const { n, at } = seen.get(b.id)!;
          if (!skip(n) && now - at >= reaction + [...b.word].length / lettersPerSecond) input.say(b.word);
        }
      }
    };
  };
  /** A player who types every Word bullet at the last moment, so there is always a word on screen. */
  const lastMoment = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += STEP) {
      session.update(STEP);
      session.state().wordBullets.filter((b) => b.flight >= 0.9).forEach((b) => input.say(b.word));
    }
  };
  return { session, input, play, typist, lastMoment };
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

describe('placing the player from their first words', () => {
  test('while the first words are on, there is no level yet', () => {
    const { session, play } = practice();
    play(3);
    expect(session.result().startLevel).toBeNull();
    expect(session.result().calibrationPace).toBeNull();
  });

  test("after the first words are typed the run is moved on to the player's level", () => {
    const { session, typist } = practice();
    typist(3)(60);
    const r = session.result();
    expect(r.startLevel).not.toBeNull();
    expect(r.startLevel!).toBeGreaterThan(0);
    expect(r.startLevel!).toBeLessThanOrEqual(PRACTICE_RAMP.rampSeconds);
    expect(r.calibrationPace).toBeGreaterThan(0);
  });

  test('a faster typist is placed further along than a slower one', () => {
    const results = [1, 3, 8].map((lettersPerSecond) => {
      const { session, typist } = practice();
      typist(lettersPerSecond)(45);
      expect(session.status).toBe('running');
      return session.result();
    });
    expect(results[0].calibrationPace!).toBeLessThan(results[1].calibrationPace!);
    expect(results[1].calibrationPace!).toBeLessThan(results[2].calibrationPace!);
    expect(results[0].startLevel!).toBeLessThan(results[1].startLevel!);
    expect(results[1].startLevel!).toBeLessThan(results[2].startLevel!);
  });

  test('a slow typist gets through the first words without losing a Life, and starts from the beginning', () => {
    const { session, typist } = practice();
    typist(1.25)(60); // about 15 words per minute
    expect(session.state().lives).toBe(3);
    expect(session.result().startLevel).toBe(0);
  });

  test('the first words never pile up: only one is on screen at a time', () => {
    const { session, typist } = practice();
    const play = typist(1.25);
    let most = 0;
    while (session.result().startLevel === null && session.status === 'running') {
      play(0.25);
      most = Math.max(most, session.state().wordBullets.length);
    }
    expect(session.result().startLevel).not.toBeNull();
    expect(most).toBe(1);
  });

  test('a slow player who misses words starts from the beginning', () => {
    const { session, typist } = practice();
    typist(1.5, (n) => n === 1 || n === 3)(60);
    expect(session.status).toBe('running'); // two Lives lost, one left
    expect(session.result().startLevel).toBe(0);
  });

  test('words a player lets through count against them: they are placed lower', () => {
    const typeAll = practice();
    typeAll.typist(4)(45);
    const missSome = practice();
    missSome.typist(4, (n) => n === 1 || n === 3)(45);
    expect(missSome.session.result().calibrationPace!).toBeLessThan(typeAll.session.result().calibrationPace!);
    expect(missSome.session.result().startLevel!).toBeLessThan(typeAll.session.result().startLevel!);
  });

  test('a player who never types is never placed: the run just ends', () => {
    const { session, play } = practice();
    play(60);
    expect(session.status).toBe('lost');
    expect(session.result().startLevel).toBeNull();
  });

  test('a typist keeps up at their own level for a good while', () => {
    const { session, typist } = practice();
    typist(4)(90);
    expect(session.status).toBe('running');
  });
});

describe('the level rises faster while the screen is empty', () => {
  /** Plays second by second until the run is placed, then on to `total` seconds. Returns how the level moved since. */
  function riseSincePlacement(player: 'fast typist' | 'last-moment player', total: number) {
    const { session, typist, lastMoment } = practice();
    const play = player === 'fast typist' ? typist(6) : lastMoment;
    let placedAt: number | null = null;
    for (let t = 0; t < total; t++) {
      play(1);
      if (placedAt === null && session.result().startLevel !== null) placedAt = session.result().survivedSeconds;
    }
    const r = session.result();
    return { session, r, since: r.survivedSeconds - placedAt!, rise: r.currentLevel! - r.startLevel! };
  }

  test('there is no level before the player is placed', () => {
    const { session, play } = practice();
    play(3);
    expect(session.result().currentLevel).toBeNull();
  });

  test('a typist who keeps clearing the screen climbs faster than time passes, but not faster than the speed-up allows', () => {
    const { r, since, rise } = riseSincePlacement('fast typist', 60);
    expect(r.currentLevel!).toBeLessThan(PRACTICE_RAMP.rampSeconds); // not capped, so the numbers mean something
    expect(rise).toBeGreaterThan(since * 1.3);
    expect(rise).toBeLessThanOrEqual(since * PRACTICE_ACCELERATION.emptyScreenRate + 1);
  });

  test('a player who always has a word to type climbs in step with time', () => {
    const { session, since, rise } = riseSincePlacement('last-moment player', 120);
    expect(session.status).toBe('running');
    expect(since).toBeGreaterThan(40);
    expect(rise).toBeGreaterThan(since * 0.9);
    expect(rise).toBeLessThan(since * 1.3);
  });

  test('the level stops moving when the run is over', () => {
    const { session, play } = practice();
    play(60); // never types: lost before being placed
    expect(session.result().currentLevel).toBeNull();
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

  test('Pace only counts the time there is a Word bullet on screen', () => {
    const { session, typist } = practice();
    typist(4)(60);
    const r = session.result();
    expect(r.activeSeconds).toBeGreaterThan(0);
    expect(r.activeSeconds).toBeLessThan(r.survivedSeconds); // the screen was empty some of the time
    expect(r.averagePace).toBeCloseTo(r.lettersTyped / r.activeSeconds, 9);
    expect(r.averagePace).toBeGreaterThan(r.lettersTyped / r.survivedSeconds);
  });

  test('time with an empty screen is not counted, however long it lasts', () => {
    const { session, input, play } = practice();
    play(1); // the first word is not out yet
    expect(session.result().activeSeconds).toBe(0);
    expect(session.result().averagePace).toBe(0);

    play(1); // it comes out at 1.5 s
    const word = session.state().wordBullets[0].word;
    input.say(word);
    const active = session.result().activeSeconds;
    expect(active).toBeGreaterThan(0);

    // The screen stays empty until the next calibration word, a short gap after it was cleared.
    play(0.5);
    expect(session.state().wordBullets).toEqual([]);
    expect(session.result().activeSeconds).toBe(active);
  });

  test('has Pace as letters per second: the average over the time words were on screen, and the best moment', () => {
    const { session, play } = practice();
    play(60, true);
    const r = session.result();
    expect(r.averagePace).toBeCloseTo(r.lettersTyped / r.activeSeconds, 9);
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
    const { session, typist } = practice();
    typist(4)(60);
    const r = session.result();
    expect(r.wpm).toBeCloseTo((r.averagePace * 60) / 5, 9);
    expect(r.wpm).toBeGreaterThan(0);
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
