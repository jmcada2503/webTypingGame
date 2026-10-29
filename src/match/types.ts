/** `versus`: two players, Word bullets come from the opponent's Shots. `practice`: alone, no Attack word. */
export type MatchMode = 'versus' | 'practice';

/**
 * Where Attack words come from. Word `i` is picked at Match time `t` (the moment the previous Attack word
 * was fired; 0 for the first). The real source is the seeded picker over the word list (server-issued seed);
 * tests use a deterministic fake.
 */
export interface AttackWordSource {
  wordAt(i: number, t: number): string;
}

/** How the Match is going. `peace` = both players stayed Idle too long: nobody wins. */
export type MatchStatus = 'running' | 'won' | 'lost' | 'peace';

/** What crosses the wire between the two players' engines (one direction each). */
export type NetEvent =
  /** I fired my `i`-th Attack word (picked at Match time `t`): it flies at you as a Word bullet. */
  | { type: 'shot'; i: number; t: number; word: string }
  /** I destroyed your Shot `i`. */
  | { type: 'defended'; i: number }
  /** Your Shot `i` reached me; I have `lives` Lives left. */
  | { type: 'hit'; i: number; lives: number }
  /** How I am doing right now (sent every couple of seconds): seconds since I last typed, and my Pace. */
  | { type: 'presence'; idleFor: number; pace: number }
  /** Both of us were Idle for too long: the Match is over, nobody wins. */
  | { type: 'peace' };

export interface MatchConfig {
  mode: MatchMode;
  attackWords: AttackWordSource;
  /** Index of the first Attack word (continues across Rematches; the same seed keeps being used). Default 0. */
  startIndex?: number;
  /** Seconds for a Word bullet to go from Flight 0 to 1. */
  bulletFlightSeconds: number;
  /** Seconds a Shot takes to reach the Enemy ship on the Radar (display only). */
  shotFlightSeconds: number;
  /**
   * Checks an incoming Shot against the opponent's seed (`ShotVerifier`); `arrivedAt` is the Match time in
   * seconds. Return false to ignore it: it never becomes a Word bullet. No check when omitted.
   */
  verifyShot?: (shot: { i: number; t: number; word: string }, arrivedAt: number) => boolean;
}

/**
 * The line to the opponent: one `send`, one `onEvent`. P2P (WebRTC) implements it; a relay could replace it
 * later without touching the rules. `onEvent` returns an unsubscribe function.
 */
export interface MatchTransport {
  send(event: NetEvent): void;
  onEvent(cb: (event: NetEvent) => void): () => void;
}
