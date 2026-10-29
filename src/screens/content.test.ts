import { describe, expect, test } from 'vitest';
import { countdownDisplay, goFlash, howToDemo, moveSelection, usableSelection, placeholderOnline, typedTip, waitingLogLine, TIPS } from './content';

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
