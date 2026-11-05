import type { KeyPress } from '../match/types';
import type { GameViewState, ViewEvent } from '../view/GameViewState';

/** The climb has one sound per step; a longer word stays on the top step. */
export const CLIMB_STEPS = 14;

/** The sound each game event makes (the rest are the scene's or an ending's business, not this ticket's). */
const EVENT_SOUNDS: Partial<Record<ViewEvent['type'], string>> = {
  wordBulletDestroyed: 'wordBulletDestroyed',
  attackFired: 'attackFired',
  shotHit: 'shotHit',
  shotDefended: 'shotDefended',
  enemyFired: 'enemyFired',
  closeWarning: 'closeWarning',
  lifeLost: 'lifeLost',
  lastLife: 'lastLife',
  wrongSubmit: 'wrongSubmit',
  idleNudge: 'idleNudge',
};

/**
 * Turns what happens in a Match or Practice run into sounds: key presses, game events, and the PEACE IN
 * countdown. It only decides *which* sound; `play` is the audio engine's. A successful submit has no key
 * sound of its own: the Word bullet destroyed / Attack fired event is what plays.
 */
export class MatchSounds {
  /** The whole number of seconds PEACE IN shows now (null: no countdown). */
  private peaceShown: number | null = null;

  constructor(private readonly play: (id: string) => void) {}

  key(key: KeyPress) {
    if (key.kind === 'match') this.play(`keyClimb${Math.min(key.index, CLIMB_STEPS - 1)}`);
    else this.play(key.kind === 'noMatch' ? 'keyNoMatch' : 'keyBackspace');
  }

  events(events: readonly ViewEvent[]) {
    for (const e of events) {
      const id = EVENT_SOUNDS[e.type];
      if (id) this.play(id);
    }
  }

  /** Each frame: a tick every time the PEACE IN number changes. */
  frame(state: GameViewState) {
    const peaceIn = state.idle.peaceIn;
    const shown = peaceIn === null ? null : Math.ceil(peaceIn);
    if (shown !== null && shown !== this.peaceShown) this.play('peaceTick');
    this.peaceShown = shown;
  }
}
