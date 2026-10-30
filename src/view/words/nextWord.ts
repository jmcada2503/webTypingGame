import { matchPrefix } from '../../utils/matchPrefix';
import type { GameViewState } from '../GameViewState';

/**
 * The Word bullet to type after the one being typed: the nearest one (highest Flight) that isn't the Target
 * (the nearest Word bullet the Typed word is a prefix of). With nothing typed, or a Typed word that fits no
 * Word bullet, it is simply the nearest. It may be farther than the Target: a player who skipped the nearest
 * word (taking the hit) still sees what comes next. Null when there is nothing else on screen.
 */
export function nextWordId(state: Pick<GameViewState, 'wordBullets' | 'typedWord'>): string | null {
  const byNear = [...state.wordBullets].sort((a, b) => b.flight - a.flight);
  const len = [...state.typedWord].length;
  const target = len > 0 ? byNear.find((b) => matchPrefix(state.typedWord, b.word) === len) : undefined;
  return byNear.find((b) => b !== target)?.id ?? null;
}
