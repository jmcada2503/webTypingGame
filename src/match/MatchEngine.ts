import { matchPrefix } from '../utils/matchPrefix';
import type { GameViewState, ShotState, ViewEvent, WordBulletState } from '../view/GameViewState';
import type { MatchConfig, MatchStatus, NetEvent } from './types';

const STARTING_LIVES = 3;
/** Each hit on the opponent adds this much Enemy ship damage (0..1, capped at 1). */
const DAMAGE_PER_HIT = 0.4;
/** Seconds without typing before the player gets an attention nudge. */
const NUDGE_AFTER = 5;
/** Both players Idle for longer than this (seconds) ends the Match in Peace. */
const PEACE_AFTER = 10;
/** Pace counts the letters of the correct words of the last PACE_WINDOW seconds, then eases toward that over PACE_EASE seconds. */
const PACE_WINDOW = 10;
const PACE_EASE = 1;
/** How often (seconds) a versus Match reports Idle time and Pace to the opponent. */
const PRESENCE_EVERY = 2;

/** True when `typed` is exactly `word` (same rule as the Targets: case-insensitive, NFC, exact letters). */
const isWord = (typed: string, word: string) => matchPrefix(typed, word) === [...word].length && [...typed].length === [...word].length;

/** A Word bullet in my game; `shot` is the opponent's Shot index when it came from them (Practice bullets have none). */
type Bullet = WordBulletState & { shot?: number };

/**
 * The rules of one Match, with no DOM and no network. Time moves only through `update(dt)`.
 * Output: `ViewEvent`s from `update`, a `GameViewState` snapshot from `state()`, and `NetEvent`s for the
 * opponent from `drainOutgoing()`; the opponent's events come in through `receive()`.
 */
/** Counters for the results screen and the Match report. */
export interface MatchStats {
  /** Match time in seconds. */
  elapsed: number;
  correctWords: number;
  correctLetters: number;
  wrongSubmits: number;
  bulletsDestroyed: number;
  bulletsArrived: number;
  shotsFired: number;
  shotsHit: number;
  shotsDefended: number;
}

export class MatchEngine {
  status: MatchStatus = 'running';
  private lives = STARTING_LIVES;
  private bullets: Bullet[] = [];
  private pending: ViewEvent[] = [];
  private outbox: NetEvent[] = [];
  private nextBulletId = 1;
  /** Match time in seconds (only moves through `update`). */
  private time = 0;
  /** My Attack word: its index, the Match time it was picked, and the word. '' in practice (no Attack word). */
  private attackIndex: number;
  private attackPickedAt = 0;
  private attackWord = '';
  private shots: (ShotState & { firedAt: number })[] = [];
  /** How many of my Shots have hit the opponent. */
  private hitsOnEnemy = 0;
  /** What the player has typed so far, and when they last typed (Idle = no typing). */
  private typedWord = '';
  private lastActivityAt = 0;
  private nudged = false;
  /** The opponent's last report of how long they had been Idle, and the Match time it arrived (none yet = active). */
  private opponentIdle: { idleFor: number; at: number } | null = null;
  /** My Pace: recent correct words (when, how many letters) and the eased value. The opponent's is what they report. */
  private correctWords: { t: number; chars: number }[] = [];
  private pace = 0;
  private opponentPace = 0;
  private nextPresenceAt = PRESENCE_EVERY;
  private count = { correctWords: 0, correctLetters: 0, wrongSubmits: 0, bulletsDestroyed: 0, bulletsArrived: 0, shotsFired: 0, shotsHit: 0, shotsDefended: 0 };

  constructor(private readonly config: MatchConfig) {
    this.attackIndex = config.startIndex ?? 0;
    if (config.mode === 'versus') this.attackWord = config.attackWords.wordAt(this.attackIndex, 0);
  }

  /** Practice: the game fires a Word bullet at the player. */
  spawnBullet(word: string) {
    if (this.status !== 'running') return;
    this.addBullet(`p${this.nextBulletId++}`, word);
  }

  /** The Typed word changed (a letter or Backspace): the player is active. */
  typed(word: string) {
    if (this.status !== 'running') return;
    this.typedWord = word;
    this.activity();
  }

  /** The player submitted a word (Space or Enter). */
  submit(word: string) {
    if (this.status !== 'running') return;
    this.activity();
    // Defending comes first. Several Word bullets may carry the same word: take the one closest to the Cockpit.
    const target = this.bullets.filter((b) => isWord(word, b.word)).sort((a, b) => b.flight - a.flight)[0];
    if (target) return this.destroy(target);
    if (this.attackWord && isWord(word, this.attackWord)) this.fire();
    else this.count.wrongSubmits++;
  }

  /** An event from the opponent. */
  receive(event: NetEvent) {
    if (this.status !== 'running') return;
    if (event.type === 'shot' && (this.config.verifyShot?.(event, this.time) ?? true)) {
      this.addBullet(`e${event.i}`, event.word, event.i);
    }
    if (event.type === 'presence') {
      this.opponentIdle = { idleFor: event.idleFor, at: this.time };
      this.opponentPace = event.pace;
    }
    if (event.type === 'peace') this.endInPeace(false);
    if (event.type === 'defended') this.resolveShot(event.i, 'shotDefended');
    if (event.type === 'hit' && this.resolveShot(event.i, 'shotHit')) {
      this.hitsOnEnemy++;
      if (event.lives === 0 && this.status === 'running') this.status = 'won';
    }
  }

  /** Events for the opponent, oldest first; clears the queue. */
  drainOutgoing(): NetEvent[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  update(dt: number): ViewEvent[] {
    if (this.status !== 'running') return this.flush(); // the Match is over: only deliver what is still pending
    this.time += dt;
    this.updatePace(dt);
    if (this.config.mode === 'versus' && this.status === 'running' && this.time >= this.nextPresenceAt) {
      this.outbox.push({ type: 'presence', idleFor: this.time - this.lastActivityAt, pace: this.pace });
      this.nextPresenceAt += PRESENCE_EVERY;
    }
    for (const b of this.bullets) b.flight += dt / this.config.bulletFlightSeconds;
    for (const b of this.bullets.filter((b) => b.flight >= 1)) this.arrive(b);
    if (this.config.mode === 'versus' && this.status === 'running' && this.bothIdle()) this.endInPeace(true);
    if (!this.nudged && this.time - this.lastActivityAt >= NUDGE_AFTER) {
      this.nudged = true;
      this.pending.push({ type: 'idleNudge' });
    }
    return this.flush();
  }

  /** How the Match went so far. */
  stats(): MatchStats {
    return { elapsed: this.time, ...this.count };
  }

  state(): GameViewState {
    return {
      lives: this.lives,
      typedWord: this.typedWord,
      attackWord: this.attackWord,
      wordBullets: this.bullets.map((b) => ({ id: b.id, word: b.word, flight: b.flight })),
      shots: this.shots.map((s) => ({ id: s.id, word: s.word, flight: Math.min(1, (this.time - s.firedAt) / this.config.shotFlightSeconds) })),
      enemyDamage: Math.min(1, this.hitsOnEnemy * DAMAGE_PER_HIT),
      pace: { player: this.pace, enemy: this.opponentPace },
    };
  }

  // ---- internals ----

  private countCorrect(word: string) {
    this.correctWords.push({ t: this.time, chars: [...word].length });
    this.count.correctWords++;
    this.count.correctLetters += [...word].length;
  }

  private updatePace(dt: number) {
    while (this.correctWords.length && this.correctWords[0].t < this.time - PACE_WINDOW) this.correctWords.shift();
    const rate = this.correctWords.reduce((n, w) => n + w.chars, 0) / PACE_WINDOW;
    if (dt > 0) this.pace += (rate - this.pace) * (1 - Math.exp(-dt / PACE_EASE));
  }

  private bothIdle() {
    if (!this.opponentIdle) return false;
    const mine = this.time - this.lastActivityAt;
    const theirs = this.opponentIdle.idleFor + (this.time - this.opponentIdle.at);
    return mine > PEACE_AFTER && theirs > PEACE_AFTER;
  }

  private endInPeace(tellOpponent: boolean) {
    if (this.status !== 'running') return;
    this.status = 'peace';
    this.pending.push({ type: 'peace' });
    if (tellOpponent) this.outbox.push({ type: 'peace' });
  }

  private flush() {
    const events = this.pending;
    this.pending = [];
    return events;
  }

  private activity() {
    this.lastActivityAt = this.time;
    this.nudged = false;
  }

  private addBullet(id: string, word: string, shot?: number) {
    this.bullets.push({ id, word, flight: 0, shot });
    this.pending.push({ type: 'enemyFired', id });
  }

  /** The opponent's answer to my Shot `i`: it leaves the Radar. False when that Shot isn't flying. */
  private resolveShot(i: number, type: 'shotHit' | 'shotDefended') {
    const id = `s${i}`;
    if (!this.shots.some((s) => s.id === id)) return false;
    this.shots = this.shots.filter((s) => s.id !== id);
    this.pending.push({ type, id });
    if (type === 'shotHit') this.count.shotsHit++;
    else this.count.shotsDefended++;
    return true;
  }

  private destroy(b: Bullet) {
    this.bullets = this.bullets.filter((x) => x.id !== b.id);
    this.pending.push({ type: 'wordBulletDestroyed', id: b.id });
    this.count.bulletsDestroyed++;
    this.countCorrect(b.word);
    if (b.shot !== undefined) this.outbox.push({ type: 'defended', i: b.shot });
  }

  private arrive(b: Bullet) {
    if (this.status !== 'running') return; // the last Life went in this same moment: later arrivals don't count
    this.bullets = this.bullets.filter((x) => x.id !== b.id);
    this.lives--;
    this.count.bulletsArrived++;
    this.pending.push({ type: 'wordBulletArrived', id: b.id }, { type: 'lifeLost' });
    if (b.shot !== undefined) this.outbox.push({ type: 'hit', i: b.shot, lives: this.lives });
    if (this.lives === 0) this.status = 'lost';
  }

  private fire() {
    const i = this.attackIndex;
    const id = `s${i}`;
    this.shots.push({ id, word: this.attackWord, flight: 0, firedAt: this.time });
    this.pending.push({ type: 'attackFired', id, word: this.attackWord });
    this.count.shotsFired++;
    this.countCorrect(this.attackWord);
    this.outbox.push({ type: 'shot', i, t: this.attackPickedAt, word: this.attackWord });
    this.attackIndex = i + 1;
    this.attackPickedAt = this.time;
    this.attackWord = this.config.attackWords.wordAt(this.attackIndex, this.time);
  }
}
