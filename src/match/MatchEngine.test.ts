import { describe, expect, test } from 'vitest';
import type { ViewEvent } from '../view/GameViewState';
import { MatchEngine } from './MatchEngine';

/** A deterministic Attack-word source: word i is list[i % list.length]. */
const words = (...list: string[]) => ({ wordAt: (i: number) => list[i % list.length] });

const engine = (overrides: Partial<ConstructorParameters<typeof MatchEngine>[0]> = {}) =>
  new MatchEngine({
    mode: 'versus',
    attackWords: words('rocket', 'meteor', 'comet'),
    bulletFlightSeconds: 8,
    shotFlightSeconds: 8,
    ...overrides,
  });

/** Advance the engine by `seconds` in quarter-second steps (exact in binary), collecting every ViewEvent. */
function advance(m: MatchEngine, seconds: number): ViewEvent[] {
  const events: ViewEvent[] = [];
  for (let t = 0; t < seconds; t += 0.25) events.push(...m.update(0.25));
  return events;
}
const types = (events: ViewEvent[]) => events.map((e) => e.type);
/** What the engine sent the opponent, ignoring the periodic presence reports. */
const sent = (m: MatchEngine) => m.drainOutgoing().filter((e) => e.type !== 'presence');

describe('Lives', () => {
  test('a Word bullet that reaches the Cockpit costs a Life', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');

    const events = advance(m, 8);

    expect(types(events)).toContain('wordBulletArrived');
    expect(types(events)).toContain('lifeLost');
    expect(m.state().lives).toBe(2);
    expect(m.state().wordBullets).toEqual([]);
  });

  test('Lives never go below zero when more bullets arrive in the same moment', () => {
    const m = engine({ mode: 'practice' });
    ['a', 'b', 'c', 'd', 'e'].forEach((w) => m.spawnBullet(w));

    const events = advance(m, 8);

    expect(m.state().lives).toBe(0);
    expect(types(events).filter((t) => t === 'lifeLost')).toHaveLength(3);
  });

  test('losing the last Life ends the Match as lost', () => {
    const m = engine({ mode: 'practice' });
    expect(m.status).toBe('running');
    ['a', 'b', 'c'].forEach((w) => m.spawnBullet(w));

    advance(m, 8);

    expect(m.state().lives).toBe(0);
    expect(m.status).toBe('lost');
  });
});

describe('Defending', () => {
  test('submitting the word of a Word bullet destroys it', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');
    advance(m, 1);

    m.submit('planet');
    const events = m.update(0);

    expect(types(events)).toEqual(['wordBulletDestroyed']);
    expect(m.state().wordBullets).toEqual([]);
    expect(m.state().lives).toBe(3);
  });

  test('when several Word bullets carry the word, the one closest to the Cockpit is destroyed', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet'); // p1, will be closest
    advance(m, 4);
    m.spawnBullet('planet'); // p2, just fired
    m.update(0);

    m.submit('planet');
    const events = m.update(0);

    expect(events).toContainEqual({ type: 'wordBulletDestroyed', id: 'p1' });
    expect(m.state().wordBullets.map((b) => b.id)).toEqual(['p2']);
  });

  test('letters must match exactly: ñ is not n and á is not a', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('ñandú');

    m.submit('nandu');
    m.submit('ñandu');

    expect(m.state().wordBullets).toHaveLength(1);
    m.submit('ñandú');
    expect(m.state().wordBullets).toHaveLength(0);
  });

  test('a submitted word that matches nothing changes nothing', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');
    m.update(0);

    m.submit('comet');

    expect(m.update(0)).toEqual([]);
    expect(m.state().wordBullets).toHaveLength(1);
  });
});

describe('Attacking', () => {
  test('the Attack word comes from the word source', () => {
    expect(engine().state().attackWord).toBe('rocket');
  });

  test('submitting the Attack word fires a Shot, sends it to the opponent and picks the next word', () => {
    const m = engine();
    advance(m, 2);

    m.submit('rocket');
    const events = m.update(0);

    expect(events).toContainEqual({ type: 'attackFired', id: 's0', word: 'rocket' });
    expect(m.state().shots).toEqual([{ id: 's0', word: 'rocket', flight: 0 }]);
    expect(sent(m)).toEqual([{ type: 'shot', i: 0, t: 0, word: 'rocket' }]);
    expect(m.state().attackWord).toBe('meteor');
  });

  test('each Attack word is picked at the Match time the previous one was fired', () => {
    const picked: [number, number][] = [];
    const m = engine({ attackWords: { wordAt: (i, t) => (picked.push([i, t]), `w${i}`) } });

    advance(m, 3);
    m.submit('w0');
    advance(m, 2);
    m.submit('w1');

    expect(picked).toEqual([[0, 0], [1, 3], [2, 5]]);
    expect(sent(m)).toEqual([
      { type: 'shot', i: 0, t: 0, word: 'w0' },
      { type: 'shot', i: 1, t: 3, word: 'w1' },
    ]);
  });

  test('after a Rematch the word index continues where the last Match stopped', () => {
    const m = engine({ startIndex: 7 });
    expect(m.state().attackWord).toBe('meteor'); // wordAt(7) = list[7 % 3] = 'meteor'
    m.submit('meteor');
    expect(sent(m)).toEqual([{ type: 'shot', i: 7, t: 0, word: 'meteor' }]);
  });
});

describe('Defending comes first', () => {
  test('a word that is both a Word bullet and the Attack word destroys the bullet and does not fire', () => {
    const m = engine();
    m.spawnBullet('rocket');

    m.submit('rocket');
    const events = m.update(0);

    expect(types(events)).toContain('wordBulletDestroyed');
    expect(types(events)).not.toContain('attackFired');
    expect(m.state().shots).toEqual([]);
    expect(sent(m)).toEqual([]);
    expect(m.state().attackWord).toBe('rocket'); // still armed: the next submit fires it
  });

  test('with no Word bullet in the way, the same word fires', () => {
    const m = engine();
    m.submit('rocket');
    expect(types(m.update(0))).toContain('attackFired');
  });
});

describe('Practice', () => {
  test('has no Attack word, so nothing can be fired', () => {
    const m = engine({ mode: 'practice' });

    expect(m.state().attackWord).toBe('');
    m.submit('rocket');

    expect(m.state().shots).toEqual([]);
    expect(sent(m)).toEqual([]);
  });

  test('a Word bullet can fly faster than the default', () => {
    const m = engine({ mode: 'practice' }); // default flight: 8 s
    m.spawnBullet('slow');
    m.spawnBullet('quick', 2);

    advance(m, 1);
    expect(m.state().wordBullets.map((b) => [b.word, b.flight])).toEqual([['slow', 0.125], ['quick', 0.5]]);

    advance(m, 1);
    expect(m.state().wordBullets.map((b) => b.word)).toEqual(['slow']); // "quick" arrived and cost a Life
    expect(m.state().lives).toBe(2);
  });
});

describe("The opponent's Shots", () => {
  test("arrive as Word bullets on my side", () => {
    const m = engine();

    m.receive({ type: 'shot', i: 4, t: 12, word: 'comet' });
    const events = m.update(0);

    expect(events).toContainEqual({ type: 'enemyFired', id: 'e4' });
    expect(m.state().wordBullets).toEqual([{ id: 'e4', word: 'comet', flight: 0 }]);
  });

  test('a Shot that reaches me costs a Life and tells the opponent it hit, with my remaining Lives', () => {
    const m = engine();
    m.receive({ type: 'shot', i: 4, t: 12, word: 'comet' });

    advance(m, 8);

    expect(m.state().lives).toBe(2);
    expect(sent(m)).toEqual([{ type: 'hit', i: 4, lives: 2 }]);
  });

  test('a Shot I destroy tells the opponent it was defended', () => {
    const m = engine();
    m.receive({ type: 'shot', i: 4, t: 12, word: 'comet' });
    m.update(0);

    m.submit('comet');

    expect(sent(m)).toEqual([{ type: 'defended', i: 4 }]);
  });

  test('Word bullets from Practice never talk to the network', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');
    m.spawnBullet('comet');
    m.submit('planet');
    advance(m, 8);

    expect(sent(m)).toEqual([]);
  });
});

describe('The result of my Shots', () => {
  /** An engine whose first `n` Attack words (rocket, meteor, comet) are fired and still flying. */
  const withShots = (n: number) => {
    const m = engine();
    ['rocket', 'meteor', 'comet'].slice(0, n).forEach((w) => m.submit(w));
    m.update(0);
    sent(m);
    return m;
  };

  test('a hit damages the Enemy ship by 40% and the Shot leaves the Radar', () => {
    const m = withShots(1);

    m.receive({ type: 'hit', i: 0, lives: 2 });
    const events = m.update(0);

    expect(events).toContainEqual({ type: 'shotHit', id: 's0' });
    expect(m.state().enemyDamage).toBeCloseTo(0.4);
    expect(m.state().shots).toEqual([]);
  });

  test('the second hit crosses the 75% damage threshold', () => {
    const m = withShots(2);

    m.receive({ type: 'hit', i: 0, lives: 2 });
    m.receive({ type: 'hit', i: 1, lives: 1 });

    expect(m.state().enemyDamage).toBeGreaterThan(0.75);
  });

  test('damage never goes past 100%, and the third hit wins the Match', () => {
    const m = withShots(3);

    m.receive({ type: 'hit', i: 0, lives: 2 });
    m.receive({ type: 'hit', i: 1, lives: 1 });
    expect(m.status).toBe('running');
    m.receive({ type: 'hit', i: 2, lives: 0 });

    expect(m.state().enemyDamage).toBe(1);
    expect(m.status).toBe('won');
  });

  test('a defended Shot shows as defended and does no damage', () => {
    const m = withShots(1);

    m.receive({ type: 'defended', i: 0 });
    const events = m.update(0);

    expect(events).toContainEqual({ type: 'shotDefended', id: 's0' });
    expect(m.state().enemyDamage).toBe(0);
    expect(m.state().shots).toEqual([]);
  });

  test('a Shot reaches the Enemy ship on the Radar after the Shot flight time and waits there for the result', () => {
    const m = withShots(1);

    advance(m, 4);
    expect(m.state().shots[0].flight).toBeCloseTo(0.5);

    advance(m, 8);
    expect(m.state().shots[0].flight).toBe(1);
  });
});

describe('Idle nudge', () => {
  test('5 seconds without typing nudges the player, once', () => {
    const m = engine();

    expect(types(advance(m, 4.75))).not.toContain('idleNudge');
    expect(types(advance(m, 0.5)).filter((t) => t === 'idleNudge')).toHaveLength(1);
    expect(types(advance(m, 20))).not.toContain('idleNudge');
  });

  test('typing restarts the Idle clock and re-arms the nudge', () => {
    const m = engine();
    advance(m, 5.25); // nudged

    m.typed('r');

    expect(types(advance(m, 4.75))).not.toContain('idleNudge');
    expect(types(advance(m, 0.5))).toContain('idleNudge');
  });

  test('submitting a word counts as activity too', () => {
    const m = engine();
    advance(m, 4);

    m.submit('anything');

    expect(types(advance(m, 4))).not.toContain('idleNudge');
  });

  test('the Typed word the player is building shows in the snapshot', () => {
    const m = engine();
    m.typed('roc');
    expect(m.state().typedWord).toBe('roc');
  });
});

describe('Peace', () => {
  test('when both players stay Idle for over 10 seconds, the Match ends in Peace', () => {
    const m = engine();
    advance(m, 4);
    m.receive({ type: 'presence', idleFor: 6, pace: 0 }); // the opponent has been idle since Match time -2

    expect(types(advance(m, 5.75))).not.toContain('peace'); // Match time 9.75: I have been idle 9.75 s
    expect(m.status).toBe('running');

    const events = advance(m, 0.5); // Match time 10.25: both idle for over 10 s
    expect(types(events)).toContain('peace');
    expect(m.status).toBe('peace');
    expect(sent(m)).toContainEqual({ type: 'peace' });
  });

  test('one player still typing keeps the Match going', () => {
    const m = engine();
    for (let k = 0; k < 15; k++) {
      m.receive({ type: 'presence', idleFor: 0.5, pace: 0 }); // the opponent keeps reporting activity
      advance(m, 2);
    }
    expect(m.status).toBe('running');

    const typing = engine();
    typing.receive({ type: 'presence', idleFor: 30, pace: 0 });
    for (let k = 0; k < 10; k++) {
      typing.typed('r'); // I keep typing, even though the opponent is long idle
      advance(typing, 4);
    }
    expect(typing.status).toBe('running');
  });

  test("the opponent's Peace ends my Match too", () => {
    const m = engine();

    m.receive({ type: 'peace' });

    expect(types(m.update(0))).toContain('peace');
    expect(m.status).toBe('peace');
  });

  test('Practice never ends in Peace', () => {
    const m = engine({ mode: 'practice' });
    advance(m, 60);
    expect(m.status).toBe('running');
  });
});

describe('Pace', () => {
  test('is the letters of the correct words per second over the last 10 seconds, eased', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');
    advance(m, 2);

    m.submit('planet'); // 6 letters at Match time 2
    advance(m, 6);
    expect(m.state().pace.player).toBeCloseTo(0.6, 1); // 6 letters / 10 s

    advance(m, 10); // the word has left the 10 s window
    expect(m.state().pace.player).toBeCloseTo(0, 1);
  });

  test('a wrong word does not count', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');

    m.submit('plante');
    advance(m, 5);

    expect(m.state().pace.player).toBe(0);
  });

  test('a fired Attack word counts like a destroyed Word bullet', () => {
    const m = engine();

    m.submit('rocket');
    advance(m, 6);

    expect(m.state().pace.player).toBeCloseTo(0.6, 1);
  });

  test("the opponent's Pace is what they last reported", () => {
    const m = engine();

    m.receive({ type: 'presence', idleFor: 0, pace: 3.5 });

    expect(m.state().pace.enemy).toBe(3.5);
  });
});

describe('Presence reports', () => {
  test('a Match sends the opponent how long I have been Idle and my Pace every 2 seconds', () => {
    const m = engine();
    m.typed('r'); // active at Match time 0

    advance(m, 2);
    expect(m.drainOutgoing()).toEqual([{ type: 'presence', idleFor: 2, pace: 0 }]);

    advance(m, 1.75);
    expect(m.drainOutgoing()).toEqual([]);
    advance(m, 0.25);
    expect(m.drainOutgoing()).toEqual([{ type: 'presence', idleFor: 4, pace: 0 }]);
  });

  test('Practice has no opponent to report to', () => {
    const m = engine({ mode: 'practice' });
    advance(m, 10);
    expect(m.drainOutgoing()).toEqual([]);
  });
});


describe('After the Match ends', () => {
  test('a lost Match ignores further input, spawns and time', () => {
    const m = engine({ mode: 'practice' });
    ['a', 'b', 'c'].forEach((w) => m.spawnBullet(w));
    advance(m, 8);
    expect(m.status).toBe('lost');

    m.spawnBullet('late');
    m.submit('late');
    m.typed('x');
    const events = advance(m, 10);

    expect(events).toEqual([]);
    expect(m.state().lives).toBe(0);
    expect(m.state().wordBullets).toEqual([]);
  });

  test("a won Match ignores the opponent's later events", () => {
    const m = engine();
    ['rocket', 'meteor', 'comet'].forEach((w) => m.submit(w));
    [2, 1, 0].forEach((lives, i) => m.receive({ type: 'hit', i, lives }));
    expect(m.status).toBe('won');
    m.update(0);

    m.receive({ type: 'shot', i: 9, t: 0, word: 'late' });

    expect(m.state().wordBullets).toEqual([]);
    expect(m.update(1)).toEqual([]);
  });

  test('a Match that ended in Peace stops', () => {
    const m = engine();
    m.receive({ type: 'peace' });
    m.update(0);

    m.receive({ type: 'shot', i: 1, t: 0, word: 'late' });
    m.submit('rocket');

    expect(m.state().wordBullets).toEqual([]);
    expect(m.state().shots).toEqual([]);
  });
});

describe('Match numbers', () => {
  test('count what happened, for the results screen and the Match report', () => {
    const m = engine({ mode: 'practice' });
    m.spawnBullet('planet');
    m.spawnBullet('comet');

    m.submit('planet'); // correct
    m.submit('zzz'); // wrong
    advance(m, 8); // 'comet' reaches the Cockpit

    expect(m.stats()).toEqual({
      elapsed: 8,
      correctWords: 1,
      correctLetters: 6,
      wrongSubmits: 1,
      bulletsDestroyed: 1,
      bulletsArrived: 1,
      shotsFired: 0,
      shotsHit: 0,
      shotsDefended: 0,
    });
  });

  test('count my Shots and what happened to them', () => {
    const m = engine();
    m.submit('rocket');
    m.submit('meteor');
    m.receive({ type: 'hit', i: 0, lives: 2 });
    m.receive({ type: 'defended', i: 1 });

    expect(m.stats()).toMatchObject({ shotsFired: 2, shotsHit: 1, shotsDefended: 1, correctWords: 2, correctLetters: 12 });
  });
});
