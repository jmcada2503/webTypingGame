import type { GameSession, SessionStatus } from '../app/GameSession';
import type { TypingInput } from '../input/TypingInput';
import { MatchEngine } from '../match/MatchEngine';
import { MatchSession } from '../match/MatchSession';
import type { GameViewState, ViewEvent } from '../view/GameViewState';
import { loadWordList, type Language, type WordList } from '../words/wordLists';
import { PRACTICE_CALIBRATION, PRACTICE_PLACEMENT, PRACTICE_RAMP, PracticeDirector } from './PracticeDirector';

/** What the Practice result screen shows (and the Match report keeps). */
export interface PracticeResult {
  /** Seconds from the start until the last Life went (or until now, while it is running). */
  survivedSeconds: number;
  /** Seconds in which at least one Word bullet was on screen: the only time there is something to type. */
  activeSeconds: number;
  /** Words typed correctly (Word bullets destroyed). */
  wordsTyped: number;
  lettersTyped: number;
  wrongSubmits: number;
  /** Right submits / all submits, 0..1. `null` when nothing was submitted. */
  accuracy: number | null;
  /** Pace over the run: letters of correct words per second of `activeSeconds` (empty-screen time is left out). */
  averagePace: number;
  /** The highest Pace reached (never below the average). */
  peakPace: number;
  /** Words per minute from the average Pace (5 letters = 1 word). */
  wpm: number;
  /** The Pace measured during the first words, in letters per second; `null` until they are done. */
  calibrationPace: number | null;
  /** The ramp second the run was moved on to from that Pace (0 = the beginning); `null` until placed. */
  startLevel: number | null;
  /** The ramp second the run is at now (it climbs faster while the screen is empty); `null` until placed. */
  currentLevel: number | null;
}

export interface PracticeOptions {
  list: WordList;
  /** Returns a number in [0, 1). Default `Math.random`. */
  random?: () => number;
}

/** Practice has no Attack word; the engine never asks for one in `practice` mode. */
const NO_ATTACK_WORDS = { wordAt: () => '' };
/** Letters per word for the words-per-minute number. */
const LETTERS_PER_WORD = 5;

/**
 * Playing alone: Word bullets come from the game (`PracticeDirector`), the rules are the Match engine's
 * in `practice` mode, and it ends at 0 Lives. Runs fully in the browser, no network.
 *
 * The first few words measure how fast the player types; the run is then moved on to that level
 * (instead of making a fast typist sit through the easy start) and keeps getting harder from there.
 */
export class PracticeSession implements GameSession {
  private readonly engine: MatchEngine;
  private readonly match: MatchSession;
  private readonly director: PracticeDirector;
  private peakPace = 0;
  private activeSeconds = 0;
  private calibrationPace: number | null = null;

  constructor(options: PracticeOptions) {
    this.engine = new MatchEngine({
      mode: 'practice',
      attackWords: NO_ATTACK_WORDS,
      bulletFlightSeconds: PRACTICE_RAMP.start.flightSeconds,
      shotFlightSeconds: 1,
    });
    this.match = new MatchSession(this.engine);
    this.director = new PracticeDirector(options);
  }

  get status(): SessionStatus {
    return this.match.status;
  }

  start() {
    this.match.start();
  }

  dispose() {
    this.match.dispose();
  }

  attachInput(input: TypingInput) {
    this.match.attachInput(input);
  }

  update(dt: number): ViewEvent[] {
    if (this.engine.status === 'running') {
      const inFlight = this.engine.state().wordBullets.map((b) => b.word);
      for (const spawn of this.director.advance(dt, inFlight)) this.match.spawnBullet(spawn.word, spawn.flightSeconds);
      // Only time with a Word bullet on screen counts: with none, there is nothing to type.
      if (this.engine.state().wordBullets.length > 0) this.activeSeconds += dt;
    }
    const events = this.match.update(dt);
    if (this.engine.status === 'running') {
      this.peakPace = Math.max(this.peakPace, this.engine.state().pace.player);
      this.placePlayerWhenReady();
    }
    return events;
  }

  state(): GameViewState {
    return this.match.state();
  }

  /** How the run went so far; final once the session is no longer running. */
  result(): PracticeResult {
    const s = this.engine.stats();
    const submits = s.correctWords + s.wrongSubmits;
    const averagePace = this.activeSeconds > 0 ? s.correctLetters / this.activeSeconds : 0;
    return {
      survivedSeconds: s.elapsed,
      activeSeconds: this.activeSeconds,
      wordsTyped: s.correctWords,
      lettersTyped: s.correctLetters,
      wrongSubmits: s.wrongSubmits,
      accuracy: submits > 0 ? s.correctWords / submits : null,
      averagePace,
      // The live Pace is a smoothed 10 s window, so early in a run it trails the average: never report less.
      peakPace: Math.max(this.peakPace, averagePace),
      wpm: (averagePace * 60) / LETTERS_PER_WORD,
      calibrationPace: this.calibrationPace,
      startLevel: this.director.startLevel,
      currentLevel: this.director.rampTime,
    };
  }

  /** Once the first words are typed or missed, measure the player and move the run on to their level. */
  private placePlayerWhenReady() {
    if (this.director.phase !== 'calibrating') return;
    const s = this.engine.stats();
    if (s.bulletsDestroyed + s.bulletsArrived < PRACTICE_CALIBRATION.words) return;
    // Letters typed per second of words on screen. A missed word adds time but no letters, so it lowers the level.
    this.calibrationPace = s.correctLetters / Math.max(this.activeSeconds, PRACTICE_PLACEMENT.minActiveSeconds);
    this.director.finishCalibration(this.calibrationPace);
  }
}

/** Loads the language's word list (cached) and makes a Practice run with it. */
export async function createPracticeSession(language: Language, random?: () => number): Promise<PracticeSession> {
  return new PracticeSession({ list: await loadWordList(language), random });
}
