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
export interface GameViewState {
  /** 0..3 */
  lives: number;
  typedWord: string;
  attackWord: string;
  wordBullets: WordBulletState[];
  /** The player's Shots still flying, shown on the Radar. */
  shots: ShotState[];
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
  | { type: 'enemyFired'; id: string };
