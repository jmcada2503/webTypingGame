import type { ScreenFlow } from '../flow/ScreenFlow';
import type { FlowState } from '../flow/types';
import type { TextGrid } from '../render/AsciiRenderer';
import { COLS, ROWS, blink, box, put, wrap } from './draw';
import type { Screen } from './Screen';

type Left = Extract<FlowState, { screen: 'opponentLeft' }>;

export interface OpponentLeftContent {
  message: string;
  /** `win`: the Match ended here and counts for the player; `none`: it never started. */
  result: { kind: 'win' | 'none'; text: string; note: string | null };
  options: { id: 'search' | 'menu'; label: string }[];
}

const MESSAGES = {
  waiting: 'THE OTHER PLAYER LEFT BEFORE THE MATCH COULD START.',
  countdown: 'THE OTHER PLAYER LEFT DURING THE COUNTDOWN. THE MATCH NEVER STARTED.',
  match: 'THE OTHER PLAYER LEFT THE MATCH AND DID NOT COME BACK IN 10 SECONDS.',
  keptDropping: "THE OTHER PLAYER'S CONNECTION KEPT DROPPING, SO THE MATCH WAS ENDED.",
};

/** What the Opponent left screen shows for a flow state: the message by where it happened, the result, the choices. */
export function opponentLeftContent(s: Left): OpponentLeftContent {
  return {
    message: s.keptDropping ? MESSAGES.keptDropping : MESSAGES[s.during],
    result: s.youWin
      ? { kind: 'win', text: 'YOU WIN', note: 'THE MATCH ENDS HERE. THE RESULT COUNTS AS A WIN FOR YOU.' }
      : { kind: 'none', text: 'NO RESULT: NOBODY WON OR LOST.', note: null },
    options: s.kind === 'public' ? [{ id: 'search', label: 'SEARCH AGAIN' }, { id: 'menu', label: 'MENU' }] : [{ id: 'menu', label: 'MENU' }],
  };
}

const W = 76;

/** The approved layout 1: a framed terminal message, with the choices under it (arrows or hjkl, Enter). */
export function opponentLeftScreen(flow: ScreenFlow): Screen {
  let sel = 0;
  return {
    enter() {
      sel = 0;
    },

    draw(text: TextGrid, t: number, s: FlowState) {
      if (s.screen !== 'opponentLeft') return;
      const c = opponentLeftContent(s);
      const win = c.result.kind === 'win';
      const lines = wrap(c.message, W - 10);
      const h = 11 + lines.length + (win ? 3 : 0);
      const c0 = (COLS - W) / 2;
      const r0 = Math.round((ROWS - h) / 2) - 2;
      box(text, c0, r0, W, h, win ? 'green' : 'yellow');
      put(text, c0 + 3, r0, ' OPPONENT LEFT ', 'yellow');
      put(text, c0 + W - 20, r0, ' CHANNEL CLOSED ', 'dim');
      lines.forEach((l, i) => put(text, c0 + 5, r0 + 3 + i, l, 'fg'));
      let r = r0 + 4 + lines.length;
      if (win) {
        put(text, c0 + 5, r, blink(t, 2) ? '>>  YOU WIN  <<' : '                ', 'green');
        put(text, c0 + 5, r + 1, c.result.note ?? '', 'dim');
        r += 3;
      } else {
        put(text, c0 + 5, r, c.result.text, 'dim');
        r += 2;
      }
      c.options.forEach((o, i) => {
        const on = i === Math.min(sel, c.options.length - 1);
        put(text, c0 + 5, r + 1 + i * 2, on ? `> ${o.label} <` : `  ${o.label}  `, on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
      });
      put(text, c0 + W - 41, r0 + h - 2, 'ARROWS OR HJKL CHOOSE   ENTER CONFIRM', 'dim');
    },

    onKey(e: KeyboardEvent, s: FlowState) {
      if (s.screen !== 'opponentLeft') return;
      const options = opponentLeftContent(s).options;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') sel = (sel + 1) % options.length;
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') sel = (sel + options.length - 1) % options.length;
      else if (k === 'Enter') {
        const choice = options[Math.min(sel, options.length - 1)].id;
        if (choice === 'search') flow.searchAgain();
        else flow.backToMenu();
      }
    },
  };
}
