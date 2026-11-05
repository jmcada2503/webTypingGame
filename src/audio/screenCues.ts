import { RESUME_COUNT_SECONDS, type FlowState, type MatchLink, type RematchState } from '../flow/types';
import type { SoundId } from './sounds';

/** What a frame shows: the flow's state and the screen-change effect (`mode`, `level` 0 = picture on, 1 = off). */
export interface CueMoment {
  flow: FlowState;
  effect: { mode: number; level: number };
}

export interface Cues {
  /** One-off sounds to play this frame. */
  play: SoundId[];
  /** The RECONNECTING loop should be playing. */
  reconnecting: boolean;
}

/** Screen-change effect modes (see `SCREEN_TRANSITION`): 2 is the TV off / on, the others sound as a glitch. */
const TV_OFF_ON = 2;
/** The TV comes back on when the picture, going from off to on, passes this level. */
const TV_ON_LEVEL = 0.9;

/** The sounds a screen moment makes, from how it differs from the frame before. */
export function screenCues(prev: CueMoment, next: CueMoment): Cues {
  const play: SoundId[] = [];
  const a = prev.effect;
  const b = next.effect;
  if (a.level === 0 && b.level > 0) play.push(b.mode === TV_OFF_ON ? 'tvOff' : 'glitch');
  if (b.mode === TV_OFF_ON && a.level >= TV_ON_LEVEL && b.level < TV_ON_LEVEL && b.level < a.level) play.push('tvOn');
  play.push(...flowCues(prev.flow, next.flow));
  const link = linkOf(next.flow);
  return { play, reconnecting: link.status === 'away' };
}

const ENDING: Record<'won' | 'lost' | 'peace' | 'practiceOver', SoundId> = { won: 'winEnding', lost: 'loseEnding', peace: 'peaceEnding', practiceOver: 'loseEnding' };

function flowCues(a: FlowState, b: FlowState): SoundId[] {
  if (a.screen === 'match' && b.screen === 'end') return [ENDING[b.result]];
  if (b.screen === 'opponentLeft' && a.screen !== 'opponentLeft') return [b.youWin ? 'opponentLeftWin' : 'errorSting'];
  if (b.screen === 'error' && a.screen !== 'error') return ['errorSting'];
  if (a.screen === 'menu' && b.screen === 'menu' && !a.serversResting && b.serversResting) return ['errorSting'];
  if (a.screen === 'end' && a.mode === 'versus' && b.screen === 'end' && b.mode === 'versus') return rematchCues(a.rematch, b.rematch);
  if (a.screen === 'end' && b.screen === 'countdown') return ['rematchAccepted', 'countdownTick'];
  if (b.screen === 'match' && a.screen !== 'match' && b.mode === 'versus') return ['go'];
  if (a.screen === 'waiting' && a.phase === 'searching' && b.screen === 'countdown') return ['opponentFound', 'countdownTick'];
  if (b.screen === 'countdown') {
    const n = Math.ceil(b.secondsLeft);
    if (n > 0 && (a.screen !== 'countdown' || Math.ceil(a.secondsLeft) !== n)) return ['countdownTick'];
  }
  if (a.screen === 'waiting' && b.screen === 'waiting' && a.phase === 'searching' && b.phase === 'connecting') return ['opponentFound'];
  if (a.screen === 'match' && b.screen === 'match') return linkCues(a.link, b.link);
  return [];
}

const linkOf = (s: FlowState): MatchLink => (s.screen === 'match' ? s.link : { status: 'ok' });

function linkCues(a: MatchLink, b: MatchLink): SoundId[] {
  if (b.status === 'away' && (a.status !== 'away' || a.losses !== b.losses)) return ['signalLost'];
  if (b.status === 'back' && a.status !== 'back') return ['enemyBack'];
  if (b.status === 'back' && a.status === 'back') {
    const n = Math.ceil(b.secondsLeft);
    if (n > 0 && n <= RESUME_COUNT_SECONDS && n !== Math.ceil(a.secondsLeft)) return ['resumeTick'];
  }
  return [];
}

function rematchCues(a: RematchState, b: RematchState): SoundId[] {
  if (a.status === b.status) return [];
  if (b.status === 'waiting' || b.status === 'incoming') return ['rematchProposed'];
  if (b.status === 'notice' && b.notice === 'declined') return ['rematchDeclined'];
  return [];
}
