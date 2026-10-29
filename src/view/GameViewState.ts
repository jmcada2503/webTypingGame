/** One Word bullet as the game sees it. */
export interface WordBulletState {
  /** Stable id assigned by the session; the view tracks visuals by it. */
  id: string;
  word: string;
  /** Flight: 0 = leaving the Enemy ship, 1 = reaching the Cockpit. */
  flight: number;
}

/** One Shot: an Attack word the player fired, flying as a Word bullet in the opponent's game. */
export interface ShotState {
  id: string;
  word: string;
  /** 0 = just fired, 1 = reaching the Enemy ship (from the opponent's game). */
  flight: number;
}

/**
 * Everything on screen that the game owns, handed to the view every frame.
 * The view keeps no game truth of its own; it only draws this (plus its own animations).
 */
/** Who is Idle (no typing), for the nudge on the Attack word and the countdown to Peace. */
export interface IdleViewState {
  /** The player has been Idle for 5 s: draw attention to the Attack word, until they type. */
  nudging: boolean;
  /** The opponent is Idle too (reported 5 s or more without typing). */
  opponentIdle: boolean;
  /** Seconds until Peace while both players are Idle; null otherwise. */
  peaceIn: number | null;
}

/** Nobody is Idle: the value for screens and sessions that have no Idle logic. */
export const NOT_IDLE: IdleViewState = { nudging: false, opponentIdle: false, peaceIn: null };

export interface GameViewState {
  /** 0..3 */
  lives: number;
  typedWord: string;
  attackWord: string;
  wordBullets: WordBulletState[];
  /** The player's Shots still flying, shown on the Radar. */
  shots: ShotState[];
  /** How damaged the Enemy ship is: 0 = intact, 1 = about to be destroyed. */
  enemyDamage: number;
  /** Each player's Pace: letters of correct words (Word bullets destroyed + Attack words fired) per second, recent. */
  pace: { player: number; enemy: number };
  idle: IdleViewState;
}

/**
 * One-off moments that start an animation. Draft list: the juice tickets extend it.
 * After `wordBulletDestroyed` / `wordBulletArrived` (and `shotHit` / `shotDefended` for Shots)
 * it disappears from the snapshot, but the view may keep its visual alive briefly for an exit animation.
 */
export type ViewEvent =
  | { type: 'wordBulletDestroyed'; id: string }
  | { type: 'wordBulletArrived'; id: string }
  | { type: 'lifeLost' }
  | { type: 'attackFired'; id: string; word: string }
  /** A Shot reached the Enemy ship. */
  | { type: 'shotHit'; id: string }
  /** The opponent typed a Shot's word and destroyed it. */
  | { type: 'shotDefended'; id: string }
  | { type: 'enemyFired'; id: string }
  /** The player has been Idle (no typing) for a while: draw attention to the Attack word. */
  | { type: 'idleNudge' }
  /** Both players stayed Idle too long: the Match ends in Peace. */
  | { type: 'peace' };
