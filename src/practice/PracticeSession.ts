import type { GameSession, SessionStatus } from '../app/GameSession';
import type { TypingInput } from '../input/TypingInput';
import { MatchEngine } from '../match/MatchEngine';
import { MatchSession } from '../match/MatchSession';
import type { GameViewState, ViewEvent } from '../view/GameViewState';
import { loadWordList, type Language, type WordList } from '../words/wordLists';
import { PRACTICE_RAMP, PracticeDirector } from './PracticeDirector';

/** What the Practice result screen shows (and the Match report keeps). */
export interface PracticeResult {
  /** Seconds from the start until the last Life went (or until now, while it is running). */
  survivedSeconds: number;
  /** Words typed correctly (Word bullets destroyed). */
  wordsTyped: number;
  lettersTyped: number;
  wrongSubmits: number;
  /** Right submits / all submits, 0..1. `null` when nothing was submitted. */
  accuracy: number | null;
  /** Pace over the whole run: letters of correct words per second. */
  averagePace: number;
  /** The highest Pace reached. */
  peakPace: number;
  /** Words per minute from the average Pace (5 letters = 1 word). */
  wpm: number;
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
 * Playing alone: Word bullets come from the game on a ramp (`PracticeDirector`), the rules are the
 * Match engine's in `practice` mode, and it ends at 0 Lives. Runs fully in the browser, no network.
 */
export class PracticeSession implements GameSession {
  private readonly engine: MatchEngine;
  private readonly match: MatchSession;
  private readonly director: PracticeDirector;
  private peakPace = 0;

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
    }
    const events = this.match.update(dt);
    if (this.engine.status === 'running') this.peakPace = Math.max(this.peakPace, this.engine.state().pace.player);
    return events;
  }

  state(): GameViewState {
    return this.match.state();
  }

  /** How the run went so far; final once the session is no longer running. */
  result(): PracticeResult {
    const s = this.engine.stats();
    const submits = s.correctWords + s.wrongSubmits;
    const averagePace = s.elapsed > 0 ? s.correctLetters / s.elapsed : 0;
    return {
      survivedSeconds: s.elapsed,
      wordsTyped: s.correctWords,
      lettersTyped: s.correctLetters,
      wrongSubmits: s.wrongSubmits,
      accuracy: submits > 0 ? s.correctWords / submits : null,
      averagePace,
      // The live Pace is a smoothed 10 s window, so early in a run it trails the average: never report less.
      peakPace: Math.max(this.peakPace, averagePace),
      wpm: (averagePace * 60) / LETTERS_PER_WORD,
    };
  }
}

/** Loads the language's word list (cached) and makes a Practice run with it. */
export async function createPracticeSession(language: Language, random?: () => number): Promise<PracticeSession> {
  return new PracticeSession({ list: await loadWordList(language), random });
}
