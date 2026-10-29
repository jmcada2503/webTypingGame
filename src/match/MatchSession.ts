import type { GameSession, SessionStatus } from '../app/GameSession';
import type { TypingInput } from '../input/TypingInput';
import type { GameViewState, ViewEvent } from '../view/GameViewState';
import type { MatchEngine } from './MatchEngine';
import type { MatchTransport } from './types';

/**
 * Plugs a `MatchEngine` into the app shell: the existing `TypingInput` feeds it what the player types and
 * submits, an optional `MatchTransport` carries events to and from the opponent (none in Practice), and
 * the engine's events and snapshot go out through the `GameSession` interface.
 */
export class MatchSession implements GameSession {
  private started = false;
  private input?: TypingInput;
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly engine: MatchEngine,
    private readonly transport?: MatchTransport,
  ) {
    if (transport) this.unsubs.push(transport.onEvent((event) => this.engine.receive(event)));
  }

  get status(): SessionStatus {
    return this.started ? this.engine.status : 'idle';
  }

  start() {
    this.started = true;
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.started = false;
  }

  attachInput(input: TypingInput) {
    this.input = input;
    this.unsubs.push(
      input.onChange((word) => this.engine.typed(word)),
      input.onSubmit((word) => this.engine.submit(word)),
    );
  }

  /** Practice: the game fires a Word bullet at the player. */
  spawnBullet(word: string) {
    this.engine.spawnBullet(word);
  }

  update(dt: number): ViewEvent[] {
    const events = this.engine.update(dt);
    for (const event of this.engine.drainOutgoing()) this.transport?.send(event);
    if (this.engine.status !== 'running') this.input?.setEnabled(false); // the Match is over: stop taking input
    return events;
  }

  state(): GameViewState {
    return this.engine.state();
  }
}
