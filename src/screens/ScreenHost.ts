import type { GameSession, SessionStatus } from '../app/GameSession';
import type { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import type { TypingInput } from '../input/TypingInput';
import { SCREEN_TRANSITION } from '../render/ScreenFilters';
import type { GameView } from '../view/GameView';
import type { GameViewState } from '../view/GameViewState';
import type { ScreenSet } from './Screen';
import { ScreenTransition, type ScreenId, transitionFor, visualOf } from './ScreenTransition';

/** What the game scene shows when no Match is feeding it (the starting gap, an idle Match). */
const IDLE_STATE: GameViewState = { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 } };

/**
 * Runs the app: it advances the `ScreenFlow`, draws the screen the flow is on, plays the screen-change effect
 * when the screen changes, and locks input while the effect runs. It is a `GameSession`, so the existing
 * `AppShell` mounts it and drives the frame loop; the Match screen is the game scene itself.
 */
export class ScreenHost implements GameSession {
  status: SessionStatus = 'running';
  private readonly transition = new ScreenTransition();
  /** The flow state the drawn screen belongs to, and which screen is drawn. It lags the flow during an effect. */
  private shown: FlowState;
  private displayed: ScreenId;
  private screenTime = 0;
  private input?: TypingInput;
  private inputOn = true;

  constructor(
    private readonly view: GameView,
    private readonly flow: ScreenFlow,
    private readonly screens: ScreenSet,
  ) {
    this.shown = flow.state();
    this.displayed = visualOf(this.shown);
    this.screens[this.displayed].enter?.(this.shown);
    this.applyView();
  }

  start() {
    window.addEventListener('keydown', this.onKey);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
  }

  attachInput(input: TypingInput) {
    this.input = input;
    this.syncInput();
  }

  update(dt: number) {
    this.flow.update(dt);
    this.transition.update(dt);
    this.screenTime += dt;
    const next = this.flow.state();
    if (!this.transition.active) {
      const change = transitionFor(this.shown, next);
      if (change) this.transition.start(change.effect, change.hold, () => this.swap());
      else this.shown = next;
    }
    SCREEN_TRANSITION.mode = this.transition.mode;
    SCREEN_TRANSITION.level = this.transition.level;
    this.syncInput();
    return [];
  }

  state(): GameViewState {
    return IDLE_STATE;
  }

  /** The picture is hidden: switch to the screen the flow is on now. */
  private swap() {
    this.shown = this.flow.state();
    this.displayed = visualOf(this.shown);
    this.screenTime = 0;
    this.screens[this.displayed].enter?.(this.shown);
    this.applyView();
  }

  private applyView() {
    const screen = this.screens[this.displayed];
    if (this.displayed === 'match') this.view.setScreen(null);
    else this.view.setScreen((text) => screen.draw(text, this.screenTime, this.shown));
  }

  /** Typing is only for the Match: elsewhere the hidden field is switched off so letters don't pile up in it. */
  private syncInput() {
    const on = this.displayed === 'match' && !this.transition.active;
    if (on !== this.inputOn) {
      this.inputOn = on;
      this.input?.setEnabled(on);
    }
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab') e.preventDefault();
    if (this.transition.active || this.displayed === 'match') return;
    this.screens[this.displayed].onKey?.(e, this.shown);
  };
}
