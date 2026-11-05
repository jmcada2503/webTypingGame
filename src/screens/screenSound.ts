import type { PlaySound, SoundId } from '../audio/sounds';
import type { ScreenFlow } from '../flow/ScreenFlow';

export const silent: PlaySound = () => {};

/** Run a flow action and play `id` only if it changed something: a key that does nothing stays quiet. */
export function act(flow: ScreenFlow, play: PlaySound, id: SoundId, action: () => void) {
  const before = JSON.stringify(flow.state());
  action();
  if (JSON.stringify(flow.state()) !== before) play(id);
}

/** Play the move blip if the selection moved. */
export function moved(play: PlaySound, before: number, after: number) {
  if (after !== before) play('menuMove');
  return after;
}
