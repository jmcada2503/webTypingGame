import type { GameSession, SessionStatus } from '../app/GameSession';
import type { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState, PlayMode } from '../flow/types';
import type { TypingInput } from '../input/TypingInput';
import type { TextGrid } from '../render/AsciiRenderer';
import { SCREEN_TRANSITION } from '../render/ScreenFilters';
import type { GameView } from '../view/GameView';
import { NOT_IDLE, type GameViewState, type ViewEvent } from '../view/GameViewState';
import { GO_SECONDS, goFlash } from './content';
import { bigNumber } from './countdownScreen';
import { ENDINGS, endingFrame, endingMoments, type EndingResult } from './endings';
import type { ScreenSet } from './Screen';
import { ScreenTransition, type ScreenId, transitionFor, visualOf } from './ScreenTransition';

/** What the game scene shows when no Match is feeding it (the TV gap before the Match). */
const IDLE_STATE: GameViewState = { lives: 3, typedWord: '', attackWord: '', wordBullets: [], shots: [], enemyDamage: 0, pace: { player: 0, enemy: 0 }, idle: NOT_IDLE };

/** Creates the session that plays one Match (or Practice). Online play and Practice each bring their own. */
export type CreateMatch = (mode: PlayMode) => GameSession;

/**
 * Runs the app: it advances the `ScreenFlow`, draws the screen the flow is on, plays the screen-change effect
 * when the screen changes, and locks input while the effect runs. It is a `GameSession`, so the existing
 * `AppShell` mounts it and drives the frame loop. On the Match screen it runs a Match session (from
 * `createMatch`) and hands its events and snapshot to the game scene; when that session ends it tells the flow.
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
  /** The running Match, and how long since it began (for the GO flash). */
  private match: GameSession | null = null;
  private matchTime = 0;
  /** The GO flash is showing over the Match scene. */
  private goOn = false;
  /** A Match or Practice run just ended: its ending scene plays (`t` seconds in) before the screen changes. */
  private ending: { result: EndingResult; t: number; started: boolean } | null = null;

  constructor(
    private readonly view: GameView,
    private readonly flow: ScreenFlow,
    private readonly screens: ScreenSet,
    private readonly createMatch: CreateMatch,
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
    this.endSession();
  }

  attachInput(input: TypingInput) {
    this.input = input;
    this.input.setEnabled(this.inputOn);
    this.syncInput();
  }

  update(dt: number): ViewEvent[] {
    this.flow.update(dt);
    this.transition.update(dt);
    this.screenTime += dt;
    const next = this.flow.state();
    if (!this.transition.active && !this.ending) {
      const change = transitionFor(this.shown, next);
      if (change) this.transition.start(change.effect, change.hold, () => this.swap());
      else this.shown = next;
    }
    SCREEN_TRANSITION.mode = this.transition.mode;
    SCREEN_TRANSITION.level = this.transition.level;
    const events = [...this.runMatch(dt), ...this.tickEnding(dt)];
    this.syncInput();
    return events;
  }

  state(): GameViewState {
    const base = this.displayed === 'match' && this.match ? this.match.state() : IDLE_STATE;
    if (!this.ending) return base;
    // The ending's effect on what the view is told: Peace keeps the Idle nudge's PEACE!! label up and the stars race, Lose slows the stars.
    const f = endingFrame(this.ending.result, this.ending.t);
    const pace = f.pace ?? base.pace.player * f.paceScale;
    const idle = this.ending.result === 'peace' ? { nudging: false, opponentIdle: false, peaceIn: 0 } : base.idle;
    return { ...base, idle, pace: { player: pace, enemy: f.pace ?? base.pace.enemy * f.paceScale } };
  }

  /** The ending scene of a Win / Lose / Peace: apply it, play its one-off moments, then change screen. */
  private tickEnding(dt: number): ViewEvent[] {
    const ending = this.ending;
    if (!ending) return [];
    const from = ending.t;
    ending.t += dt;
    const events: ViewEvent[] = endingMoments(ending.result, from, ending.t).map(() => ({ type: 'enemyDestroyed' }));
    const plan = ENDINGS[ending.result];
    if (ending.t >= plan.sceneSeconds && !ending.started && !this.transition.active) {
      ending.started = true;
      this.transition.start(plan.effect, plan.hold, () => this.swap());
    } else if (!ending.started) this.view.setEnding(endingFrame(ending.result, ending.t));
    return events;
  }

  /** The Match: create its session when the flow enters the Match, feed it, and report when it ends. */
  private runMatch(dt: number): ViewEvent[] {
    const s = this.flow.state();
    if (s.screen !== 'match') return [];
    if (!this.match) this.beginMatch(s.mode);
    const match = this.match!;
    let events: ViewEvent[] = [];
    if (match.status === 'running') {
      this.matchTime += dt;
      if (this.goOn && this.matchTime >= GO_SECONDS) {
        this.goOn = false;
        this.view.setOverlay(null);
      }
      events = match.update(dt);
    }
    // Re-read: the session may have ended during that update. The flow ignores a result it already has.
    const status: SessionStatus = match.status;
    if (status === 'won' || status === 'lost' || status === 'peace') this.finishMatch(status);
    return events;
  }

  /** Dev keys: end the running Match with this result, as if the session had. */
  endMatch(result: EndingResult) {
    this.finishMatch(result);
  }

  private finishMatch(result: EndingResult) {
    if (this.ending) return;
    this.flow.matchEnded(result);
    const online = this.flow.state().screen === 'end' && this.shown.screen === 'match' && this.shown.mode === 'versus';
    this.flow.holdRematch(online); // its clocks start when the end screen is up
    // The scene plays its ending before the end screen. Practice only ends when the last Life goes: the Lose ending.
    if (this.flow.state().screen === 'end' && this.shown.screen === 'match') {
      const shownResult = this.shown.mode === 'practice' ? 'lost' : result;
      this.ending = { result: shownResult, t: 0, started: false };
      this.view.setEnding(endingFrame(shownResult, 0));
    }
  }

  private beginMatch(mode: PlayMode) {
    const match = this.createMatch(mode);
    if (this.input) match.attachInput(this.input);
    match.start();
    this.match = match;
    this.matchTime = 0;
    this.goOn = mode === 'versus'; // GO ends a Countdown; Practice has none
    this.applyView();
  }

  private endSession() {
    this.match?.dispose();
    this.match = null;
    this.goOn = false;
  }

  /** The picture is hidden: switch to the screen the flow is on now. */
  private swap() {
    this.shown = this.flow.state();
    this.displayed = visualOf(this.shown);
    this.screenTime = 0;
    this.ending = null;
    this.flow.holdRematch(false);
    this.view.setEnding(null);
    if (this.displayed !== 'match') this.endSession();
    this.screens[this.displayed].enter?.(this.shown);
    this.applyView();
  }

  private applyView() {
    const screen = this.screens[this.displayed];
    if (this.displayed === 'match') {
      this.view.setScreen(null);
      // GO flashes over the scene for the first moments of the Match.
      this.view.setOverlay(this.goOn ? (text) => this.drawGo(text) : null);
    } else {
      this.view.setOverlay(null);
      this.view.setScreen((text) => screen.draw(text, this.screenTime, this.shown));
    }
  }

  private drawGo(text: TextGrid) {
    if (goFlash(this.matchTime)) bigNumber(text, 'GO', 11, 13, 'green');
  }

  /** Typing is only for the Match: elsewhere the hidden field is switched off so letters don't pile up in it. */
  private syncInput() {
    const on = this.displayed === 'match' && !this.transition.active && this.match?.status === 'running';
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
