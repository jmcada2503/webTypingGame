import { describe, expect, test } from 'vitest';
import { countdownDisplay, countingScore, practiceDifficulty, practiceStatCells, practiceVerdict, settlePracticeBest, matchStatsLines, practiceScore, goFlash, howToDemo, moveSelection, usableSelection, placeholderOnline, typedTip, waitingLogLine, TIPS } from './content';

describe('online counts (placeholder until the presence endpoint exists)', () => {
  test('are stale on purpose: they only change every 30 seconds', () => {
    expect(placeholderOnline(0)).toEqual(placeholderOnline(29.9));
    expect(placeholderOnline(0)).not.toEqual(placeholderOnline(30));
  });

  test('add up and stay in a believable range', () => {
    for (let t = 0; t < 600; t += 30) {
      const o = placeholderOnline(t);
      expect(o.total).toBe(o.en + o.es);
      expect(o.en).toBeGreaterThanOrEqual(90);
      expect(o.en).toBeLessThanOrEqual(105);
      expect(o.es).toBeGreaterThanOrEqual(28);
      expect(o.es).toBeLessThanOrEqual(34);
    }
  });
});

describe('menu selection', () => {
  test('moves to the next and previous card, wrapping around', () => {
    expect(moveSelection(0, 1, false)).toBe(1);
    expect(moveSelection(2, 1, false)).toBe(0);
    expect(moveSelection(0, -1, false)).toBe(2);
  });

  test('skips the online cards while the servers are resting', () => {
    expect(moveSelection(0, 1, true)).toBe(0);
    expect(moveSelection(1, 1, true)).toBe(0);
    expect(moveSelection(2, -1, true)).toBe(0);
  });
});

describe('menu selection when the servers start resting', () => {
  test('keeps a usable card as it is', () => {
    expect(usableSelection(0, true)).toBe(0);
    expect(usableSelection(2, false)).toBe(2);
  });

  test('moves off an online card that just became unavailable, to Practice', () => {
    expect(usableSelection(1, true)).toBe(0);
    expect(usableSelection(2, true)).toBe(0);
  });
});

describe('waiting screen channel log', () => {
  test('a Public search opens a channel, enters the queue, then scans sectors forever', () => {
    expect(waitingLogLine(0, 'public', 'en')).toEqual(['OPENING CHANNEL', 'OK', 'green']);
    expect(waitingLogLine(1, 'public', 'en')).toEqual(['LANGUAGE', 'ENGLISH', 'fg']);
    expect(waitingLogLine(2, 'public', 'es')[0]).toBe('ENTERING QUEUE');
    expect(waitingLogLine(1, 'public', 'es')[1]).toBe('SPANISH');
    expect(waitingLogLine(3, 'public', 'en')).toEqual(['SCANNING SECTOR 07', 'NO CONTACT', 'yellow']);
    const later = waitingLogLine(40, 'public', 'en');
    expect(later[0]).toMatch(/^SCANNING SECTOR \d\d$/);
    expect(later[1]).toBe('NO CONTACT');
  });

  test('a Private match creates the match and the Invite link, then waits for the guest', () => {
    expect(waitingLogLine(2, 'private', 'en')[0]).toBe('CREATING PRIVATE MATCH');
    expect(waitingLogLine(3, 'private', 'en')).toEqual(['INVITE LINK', 'READY', 'green']);
    expect(waitingLogLine(4, 'private', 'en')).toEqual(['WAITING FOR GUEST', 'NO ONE YET', 'yellow']);
    expect(waitingLogLine(5, 'private', 'en')[0]).toBe('PINGING GUEST SLOT 1');
  });
});

describe('waiting screen tips', () => {
  test('one tip shows for 6 seconds and is typed out letter by letter', () => {
    expect(typedTip(0)).toBe('');
    expect(typedTip(1)).toBe(TIPS[0].slice(0, 22));
    expect(typedTip(5.9)).toBe(TIPS[0].slice(0, 129).slice(0, TIPS[0].length));
  });

  test('then the next tip follows, and the list wraps around', () => {
    expect(typedTip(6.5)).toBe(TIPS[1].slice(0, 11));
    expect(typedTip(6 * TIPS.length + 1)).toBe(TIPS[0].slice(0, 22));
  });
});

describe('how-to demo (a 10 second loop)', () => {
  test('a word flies in, gets typed letter by letter, and is destroyed', () => {
    expect(howToDemo(1)).toMatchObject({ bulletOn: true, defTyped: 0, boom: -1 });
    expect(howToDemo(2.6)).toMatchObject({ bulletOn: true, defTyped: 1 });
    expect(howToDemo(4.5)).toMatchObject({ defTyped: 6 });
    expect(howToDemo(4.9).bulletOn).toBe(false);
    expect(howToDemo(4.9).boom).toBeGreaterThan(0);
  });

  test('then the red word is typed, fired, and hits', () => {
    expect(howToDemo(5.5).atkTyped).toBe(0);
    expect(howToDemo(6.5).atkTyped).toBeGreaterThan(0);
    expect(howToDemo(7).atkTyped).toBeGreaterThan(0);
    expect(howToDemo(8)).toMatchObject({ shotOn: true, atkTyped: 0 });
    expect(howToDemo(9.5).hit).toBeGreaterThan(0);
  });

  test('loops every 10 seconds', () => {
    expect(howToDemo(13.5)).toEqual(howToDemo(3.5));
    expect(howToDemo(27.25)).toEqual(howToDemo(7.25));
  });
});


describe('countdown number', () => {
  test('shows 5 down to 1, each for a second, never 0', () => {
    expect(countdownDisplay(5)).toMatchObject({ n: 5, frac: 0 });
    expect(countdownDisplay(4.5)).toMatchObject({ n: 5, frac: 0.5 });
    expect(countdownDisplay(4)).toMatchObject({ n: 4, frac: 0 });
    expect(countdownDisplay(1.25)).toMatchObject({ n: 2, frac: 0.75 });
    expect(countdownDisplay(0.25)).toMatchObject({ n: 1, frac: 0.75 });
    expect(countdownDisplay(0).n).toBe(1);
    expect(countdownDisplay(-0.1).n).toBe(1);
  });

  test('the last two seconds are red', () => {
    expect([5, 4, 3, 2, 1].map((n) => countdownDisplay(n - 0.5).color)).toEqual(['yellow', 'yellow', 'yellow', 'red', 'red']);
  });

  test('each number gets a color-split pulse in the first moments of its second, and shrinks as the second runs out', () => {
    expect(countdownDisplay(5).pulse).toBe(true);
    expect(countdownDisplay(4.9).pulse).toBe(true);
    expect(countdownDisplay(4.5).pulse).toBe(false);
    expect(countdownDisplay(5).scale).toBeCloseTo(13);
    expect(countdownDisplay(4.5).scale).toBeCloseTo(12);
  });
});

describe('GO flash', () => {
  test('flashes for just under a second after the Match starts, then is gone', () => {
    expect(goFlash(-0.1)).toBe(false);
    expect(goFlash(0)).toBe(true);
    expect(goFlash(0.1)).toBe(true); // blinks 8 times a second: on for 1/8 s, off for 1/8 s
    expect(goFlash(0.13)).toBe(false);
    expect(goFlash(0.26)).toBe(true);
    expect(goFlash(0.76)).toBe(true);
    expect(goFlash(0.9)).toBe(false);
    expect(goFlash(5)).toBe(false);
  });
});

describe('Practice stat grid', () => {
  const run = { survivedSeconds: 83.4, wordsTyped: 12, accuracy: 12 / 13, peakPace: 4.5, wpm: 37.7, currentLevel: 300 };

  test('is six label / value cells, read row by row: time, difficulty, words, then WPM, accuracy, best pace', () => {
    expect(practiceStatCells(run)).toEqual([
      ['TIME', '01:23'],
      ['DIFFICULTY', '50%'],
      ['WORDS', '12'],
      ['WPM', '38'],
      ['ACCURACY', '92%'],
      ['BEST PACE', '4.5 L/S'],
    ]);
  });

  test('shows a dash for accuracy when nothing was submitted, and for difficulty before the run was placed', () => {
    const cells = new Map(practiceStatCells({ ...run, accuracy: null, wordsTyped: 0, currentLevel: null }));
    expect(cells.get('ACCURACY')).toBe('-');
    expect(cells.get('DIFFICULTY')).toBe('-');
  });
});

describe('Practice difficulty reached', () => {
  test('is the ramp second reached as a share of the whole ramp, capped at the top', () => {
    expect(practiceDifficulty({ currentLevel: 0 })).toBe(0);
    expect(practiceDifficulty({ currentLevel: 300 })).toBe(0.5);
    expect(practiceDifficulty({ currentLevel: 9999 })).toBe(1);
  });

  test('is unknown before the run was placed on the ramp', () => {
    expect(practiceDifficulty({ currentLevel: null })).toBeNull();
  });
});

describe('Practice verdict', () => {
  test('is one word by the difficulty reached, at 20 / 40 / 60 / 80 %', () => {
    expect(practiceVerdict(0)).toBe('WARMING UP');
    expect(practiceVerdict(0.199)).toBe('WARMING UP');
    expect(practiceVerdict(0.2)).toBe('STEADY HANDS');
    expect(practiceVerdict(0.4)).toBe('QUICK FINGERS');
    expect(practiceVerdict(0.6)).toBe('ACE TYPIST');
    expect(practiceVerdict(0.8)).toBe('UNSTOPPABLE');
    expect(practiceVerdict(1)).toBe('UNSTOPPABLE');
  });

  test('is WARMING UP for a run that was never placed on the ramp', () => {
    expect(practiceVerdict(null)).toBe('WARMING UP');
  });
});

describe('Practice session best', () => {
  /** A stand-in for sessionStorage. */
  const memory = () => {
    const items = new Map<string, string>();
    return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
  };

  test('the first scoring run is a new best, with no best before it', () => {
    const storage = memory();
    expect(settlePracticeBest(1200, () => storage)).toEqual({ bestBefore: null, newBest: true });
  });

  test('a higher score is a new best; it reports the best it beat', () => {
    const storage = memory();
    settlePracticeBest(1200, () => storage);
    expect(settlePracticeBest(1500, () => storage)).toEqual({ bestBefore: 1200, newBest: true });
    expect(settlePracticeBest(1300, () => storage)).toEqual({ bestBefore: 1500, newBest: false });
  });

  test('a run that only ties the best is not a new best', () => {
    const storage = memory();
    settlePracticeBest(1200, () => storage);
    expect(settlePracticeBest(1200, () => storage)).toEqual({ bestBefore: 1200, newBest: false });
  });

  test('a score of 0 is never a best', () => {
    const storage = memory();
    expect(settlePracticeBest(0, () => storage)).toEqual({ bestBefore: null, newBest: false });
    expect(storage.getItem('practice.best')).toBeNull();
  });

  test('without storage (blocked, private mode) every run just has no best', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    expect(settlePracticeBest(1200, blocked)).toEqual({ bestBefore: null, newBest: false });
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(settlePracticeBest(1200, () => full)).toEqual({ bestBefore: null, newBest: false });
  });

  test('ignores a stored value that is not a number', () => {
    const storage = memory();
    storage.setItem('practice.best', 'oops');
    expect(settlePracticeBest(1200, () => storage)).toEqual({ bestBefore: null, newBest: true });
  });
});

describe('the counting score', () => {
  test('counts up from 0 to the score over 1.2 s, then stays', () => {
    expect(countingScore(4200, 0)).toBe(0);
    expect(countingScore(4200, 0.6)).toBe(2100);
    expect(countingScore(4200, 1.2)).toBe(4200);
    expect(countingScore(4200, 5)).toBe(4200);
  });
});

describe('Practice score (the difficulty level reached)', () => {
  test('is 10 points for each second of the difficulty ramp the run reached', () => {
    expect(practiceScore({ currentLevel: 0 })).toBe(0);
    expect(practiceScore({ currentLevel: 100 })).toBe(1000);
    expect(practiceScore({ currentLevel: 123.46 })).toBe(1235);
  });

  test('is 0 when the run never got past the speed measurement', () => {
    expect(practiceScore({ currentLevel: null })).toBe(0);
  });

  test('stops at the top of the ramp (6000), where the difficulty stops rising', () => {
    expect(practiceScore({ currentLevel: 600 })).toBe(6000);
    expect(practiceScore({ currentLevel: 9999 })).toBe(6000);
  });
});

describe('matchStatsLines (the stats block of the online end screens)', () => {
  const stats = { elapsed: 125, correctWords: 18, correctLetters: 100, wrongSubmits: 2, bulletsDestroyed: 12, bulletsArrived: 3, shotsFired: 6, shotsHit: 4, shotsDefended: 2 };

  test('shows time, pace, accuracy, words destroyed and shots hit', () => {
    expect(matchStatsLines(stats)).toEqual([
      'TIME              02:05',
      'PACE              0.8 LETTERS/S (10 WPM)',
      'ACCURACY          90%',
      'WORDS DESTROYED   12',
      'SHOTS HIT         4 OF 6',
    ]);
  });

  test('a Lose also shows how damaged the Enemy ship was', () => {
    expect(matchStatsLines(stats, 0.8).at(-1)).toBe('ENEMY DAMAGE      80%');
  });

  test('an empty Match shows dashes, not NaN', () => {
    const lines = matchStatsLines({ ...stats, elapsed: 0, correctWords: 0, correctLetters: 0, wrongSubmits: 0, bulletsDestroyed: 0, shotsFired: 0, shotsHit: 0 });
    expect(lines[1]).toBe('PACE              0.0 LETTERS/S (0 WPM)');
    expect(lines[2]).toBe('ACCURACY          -');
  });
});
