import type { FlowState } from '../../flow/types';
import type { ScreenId } from '../../screens/ScreenTransition';
import type { Mood } from './intensity';

export type MusicState = 'menu' | 'countdown' | 'starting' | 'match' | 'held' | 'endingWin' | 'endingLose' | 'endingPeace' | 'end';

/**
 * The part of the music for what the player sees: `shown` is the screen on view, which lags the flow while a
 * Match's ending scene plays (the flow is already on the end screen).
 */
export function musicStateOf(s: FlowState, shown: ScreenId): MusicState {
  if (s.screen === 'countdown') return 'countdown';
  if (s.screen === 'starting') return 'starting';
  if (s.screen === 'match') return s.link.status === 'ok' ? 'match' : 'held';
  if (s.screen === 'end' && shown === 'match') return s.mode === 'practice' || s.result === 'lost' ? 'endingLose' : s.result === 'won' ? 'endingWin' : 'endingPeace';
  if (s.screen === 'end') return 'end';
  return 'menu';
}

/** The end screen loop's harmony: major after a Win, neutral after Peace, dark after a loss (and Practice). */
export function endMoodOf(s: FlowState): Mood {
  if (s.screen !== 'end' || s.mode === 'practice') return -1;
  return s.result === 'won' ? 1 : s.result === 'peace' ? 0 : -1;
}
