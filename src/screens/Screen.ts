import type { FlowState } from '../flow/types';
import type { TextGrid } from '../render/AsciiRenderer';
import type { ScreenId } from './ScreenTransition';

/** One screen of the app: draws itself on the text grid and reacts to keys. The flow decides when it is shown. */
export interface Screen {
  /** The screen just became visible (its clock restarts). */
  enter?(state: FlowState): void;
  /** Draw one frame; `t` is the seconds since the screen became visible. */
  draw(text: TextGrid, t: number, state: FlowState): void;
  /** A key was pressed while this screen is visible and no screen-change effect is running. */
  onKey?(e: KeyboardEvent, state: FlowState): void;
}

export type ScreenSet = Record<ScreenId, Screen>;
