import type { TypingInput } from '../input/TypingInput';
import type { GameViewState, ViewEvent } from '../view/GameViewState';

/** `peace`: both players stayed Idle too long, nobody won. */
export type SessionStatus = 'idle' | 'running' | 'won' | 'lost' | 'peace';

/**
 * Anything the app shell can run: SandboxSession now (tweak-panel driven), MatchSession later
 * (real mechanics + networking). No pause/resume: an online Match can't pause; the sandbox's
 * pause/step live on SandboxSession only.
 *
 * Shell loop each frame:  events = session.update(dt); events.forEach(view.trigger); view.render(session.state(), dt)
 */
export interface GameSession {
  readonly status: SessionStatus;
  start(): void;
  /** Stop timers, release input, free resources. */
  dispose(): void;
  /** The session reads typedWord / onSubmit from here. */
  attachInput(input: TypingInput): void;
  /** Online Matches only: hold time while the opponent's signal is lost. */
  hold?(held: boolean): void;
  /** Advance by dt seconds; returns the one-off events that happened. */
  update(dt: number): ViewEvent[];
  state(): GameViewState;
}
