import type { FlowState } from '../flow/types';

/** One screen-change effect: which shader effect, and how long it takes to ramp up (`out`) and back down (`in`). */
export interface TransitionEffect {
  /** 1 channel flip, 2 TV off / on, 3 static cut, 4 glitch (see `SCREEN_TRANSITION` in ScreenFilters). */
  mode: 1 | 2 | 3 | 4;
  out: number;
  in: number;
}

/** Menu navigation: slices jump sideways and the colors split, 0.3 s in all. */
export const GLITCH: TransitionEffect = { mode: 4, out: 0.13, in: 0.17 };
/** The picture collapses to a line and a dot, and expands back after the hold. */
export const TV_OFF_ON: TransitionEffect = { mode: 2, out: 0.35, in: 0.45 };
/** Seconds the screen stays black between TV off and TV on at the start of a Match. */
export const MATCH_START_HOLD = 1;

const EPS = 1e-9;

/**
 * The timeline of one screen change: the effect ramps up (`out`), the screen is swapped while the picture is
 * hidden, the screen stays off for `hold` seconds, then the effect ramps down (`in`). Pure timing: the host
 * reads `level` and `mode` every frame and feeds them to the shader. `active` is true while input must be locked.
 */
export class ScreenTransition {
  private effect: TransitionEffect | null = null;
  private phase: 'out' | 'hold' | 'in' = 'out';
  private t = 0;
  private hold = 0;
  private onSwap: () => void = () => {};

  get active() {
    return this.effect !== null;
  }

  get mode() {
    return this.effect?.mode ?? 0;
  }

  /** 0 = normal picture, 1 = fully off. */
  get level() {
    if (!this.effect) return 0;
    if (this.phase === 'hold') return 1;
    const duration = this.phase === 'out' ? this.effect.out : this.effect.in;
    const u = Math.min(1, this.t / duration);
    return this.phase === 'out' ? u * u : (1 - u) * (1 - u);
  }

  /** Start an effect; `onSwap` runs once, while the picture is hidden. False if one is already running. */
  start(effect: TransitionEffect, hold: number, onSwap: () => void) {
    if (this.effect) return false;
    this.effect = effect;
    this.hold = hold;
    this.onSwap = onSwap;
    this.phase = 'out';
    this.t = 0;
    return true;
  }

  update(dt: number) {
    let left = dt;
    while (this.effect) {
      const duration = this.phase === 'out' ? this.effect.out : this.phase === 'hold' ? this.hold : this.effect.in;
      const room = duration - this.t;
      if (left < room - EPS) {
        this.t += left;
        return;
      }
      left -= room;
      this.t = 0;
      if (this.phase === 'out') {
        this.onSwap();
        this.phase = this.hold > 0 ? 'hold' : 'in';
      } else if (this.phase === 'hold') this.phase = 'in';
      else this.effect = null;
    }
  }
}

/** Which screen is drawn: the starting gap shows the Match scene (the TV is switching off over the Countdown). */
export type ScreenId = 'menu' | 'howto' | 'waiting' | 'countdown' | 'match' | 'end' | 'opponentLeft' | 'error';

export const visualOf = (state: FlowState): ScreenId => (state.screen === 'starting' ? 'match' : state.screen);

/** The effect to play when the flow moves from `prev` to `next`, or null when the drawn screen stays the same. */
export function transitionFor(prev: FlowState, next: FlowState): { effect: TransitionEffect; hold: number } | null {
  if (visualOf(prev) === visualOf(next)) return null;
  if (next.screen === 'starting') return { effect: TV_OFF_ON, hold: MATCH_START_HOLD };
  return { effect: GLITCH, hold: 0 };
}
