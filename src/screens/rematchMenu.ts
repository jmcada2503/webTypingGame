import type { MatchKind, RematchState } from '../flow/types';
import { DEFAULT_FLOW_CONFIG } from '../flow/types';
import type { PaletteColor } from '../render/AsciiRenderer';

/** The choices on the Rematch menu. */
export type RematchChoice = 'rematch' | 'search' | 'menu' | 'accept' | 'deny' | 'cancel';

export interface RematchMenu {
  options: { id: RematchChoice; label: string }[];
  status: { text: string; color: PaletteColor; /** animated trailing dots */ dots: boolean } | null;
  /** The thin bar along the bottom: the 10 s window, or the answer time of a request. */
  bar: { kind: 'window' | 'answer'; fraction: number; seconds: number; color: PaletteColor; caption: string | null } | null;
}

const LABELS: Record<RematchChoice, string> = { rematch: 'REMATCH', search: 'SEARCH NEW MATCH', menu: 'MENU', accept: 'ACCEPT', deny: 'DENY', cancel: 'CANCEL' };
const opt = (id: RematchChoice) => ({ id, label: LABELS[id] });
const WINDOW_RED_AT = 3;
const ANSWER_RED_AT = 1.5;

/** What the Rematch menu shows for a Rematch state (the "edge bar" layout of the Rematch prototype). */
export function rematchMenu(r: RematchState, kind: MatchKind): RematchMenu {
  const { rematchWindowSeconds: windowTotal, rematchAnswerSeconds: answerTotal } = DEFAULT_FLOW_CONFIG;
  const search = kind === 'public' ? ['search' as const] : [];
  const withRematch = (can: boolean): RematchChoice[] => [...(can ? ['rematch' as const] : []), ...search, 'menu'];
  const make = (ids: RematchChoice[], status: RematchMenu['status'] = null, bar: RematchMenu['bar'] = null): RematchMenu => ({ options: ids.map(opt), status, bar });
  const answerBar = (left: number, caption: string): RematchMenu['bar'] => ({
    kind: 'answer',
    fraction: Math.min(1, Math.max(0, left / answerTotal)),
    seconds: Math.ceil(Math.max(0, left)),
    color: left <= ANSWER_RED_AT ? 'red' : 'green',
    caption,
  });

  switch (r.status) {
    case 'available': {
      const bar: RematchMenu['bar'] =
        r.secondsLeft === null ? null : { kind: 'window', fraction: Math.min(1, r.secondsLeft / windowTotal), seconds: Math.ceil(r.secondsLeft), color: r.secondsLeft <= WINDOW_RED_AT ? 'red' : 'yellow', caption: null };
      return make(withRematch(true), null, bar);
    }
    case 'waiting':
      return make(['cancel'], { text: 'WAITING FOR OPPONENT', color: 'yellow', dots: true }, answerBar(r.answerSecondsLeft, 'TIME FOR THEM TO ANSWER'));
    case 'incoming':
      return make(['accept', 'deny'], { text: 'OPPONENT WANTS A REMATCH', color: 'yellow', dots: false }, answerBar(r.answerSecondsLeft, 'TIME TO ANSWER'));
    case 'notice': {
      const text = { noAnswer: 'NO ANSWER', tooLate: 'TOO LATE', declined: 'DECLINED' }[r.notice];
      const color: PaletteColor = r.notice === 'declined' ? 'red' : 'dim';
      const back = !r.closes && (r.secondsLeft === null || r.secondsLeft > 0);
      return make(withRematch(back), { text, color, dots: false });
    }
    case 'closed':
      return make(withRematch(false), { text: 'REMATCH CLOSED', color: 'dim', dots: false });
    case 'opponentLeft':
      return make(withRematch(false), { text: 'OPPONENT LEFT', color: 'red', dots: false });
  }
}
