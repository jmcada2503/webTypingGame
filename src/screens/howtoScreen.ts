import type { ScreenFlow } from '../flow/ScreenFlow';
import type { PaletteColor, TextGrid } from '../render/AsciiRenderer';
import { COLS, blink, box, centered, put, twoTone } from './draw';
import { DEMO_ATTACK_WORD, DEMO_DEFEND_WORD, howToDemo } from './content';
import type { Screen } from './Screen';

const AUTO_SECONDS = 30;

/** A word with its first `n` letters typed (`typed` color) and the rest in `rest`. */
function word(text: TextGrid, c: number, r: number, w: string, n: number, rest: PaletteColor, typed: PaletteColor) {
  put(text, c, r, w.slice(0, n), typed);
  put(text, c + n, r, w.slice(n), rest);
}

function prompt(text: TextGrid, c: number, r: number, typed: string, t: number, color: PaletteColor) {
  put(text, c, r, '>', 'dim');
  put(text, c + 2, r, typed, color);
  if (blink(t)) put(text, c + 2 + typed.length, r, '_', 'fg');
}

function miniScene(text: TextGrid, c0: number, r0: number, kind: 'defend' | 'attack', t: number) {
  const d = howToDemo(t);
  const w = 56;
  box(text, c0, r0, w, 27, 'dim');
  put(text, c0 + 3, r0, kind === 'defend' ? ' DEFEND ' : ' ATTACK ', kind === 'defend' ? 'yellow' : 'red');
  const cx = c0 + w / 2;
  put(text, cx - 1, r0 + 3, '<@>', kind === 'attack' && d.hit >= 0 && blink(t, 6) ? 'green' : 'fg');
  put(text, cx - 3, r0 + 15, '[ YOU ]', 'fg');
  if (kind === 'defend') {
    if (d.bulletOn) {
      const y = r0 + 5 + d.flight * 9;
      word(text, cx - 3, y, DEMO_DEFEND_WORD, d.defTyped, 'fg', 'green');
      put(text, cx, y + 1, 'v', 'dim');
    }
    if (d.boom >= 0) {
      put(text, cx - 4, r0 + 12, '* * * * *', 'yellow');
      put(text, cx - 4, r0 + 17, 'DESTROYED', 'green');
    }
    prompt(text, cx - 6, r0 + 19, DEMO_DEFEND_WORD.slice(0, d.defTyped), t, 'green');
    put(text, c0 + 4, r0 + 22, 'TYPE THE WORD FLYING AT YOU', 'fg');
    put(text, c0 + 4, r0 + 23, 'THEN PRESS ENTER', 'dim');
  } else {
    word(text, cx - 3, r0 + 13, DEMO_ATTACK_WORD, d.atkTyped, 'red', 'fg');
    if (d.shotOn) put(text, cx, r0 + 13 - d.shotFlight * 9, '^', 'yellow');
    if (d.hit >= 0 && d.hit < 0.7) put(text, cx + 3, r0 + 3, 'HIT!', 'green');
    prompt(text, cx - 6, r0 + 19, DEMO_ATTACK_WORD.slice(0, d.atkTyped), t, 'fg');
    put(text, c0 + 4, r0 + 22, 'TYPE YOUR RED WORD', 'fg');
    put(text, c0 + 4, r0 + 23, 'THEN PRESS ENTER TO FIRE', 'dim');
  }
}

/** The approved how-to (layout B): DEFEND and ATTACK demos side by side, an Enter button and a 30 s auto-start. */
export function howtoScreen(flow: ScreenFlow): Screen {
  return {
    draw(text, t, s) {
      if (s.screen !== 'howto') return;
      twoTone(text, 1, 'HOW TO ', 'PLAY', 3.2);
      miniScene(text, 6, 6, 'defend', t);
      miniScene(text, 66, 6, 'attack', t);
      const secs = Math.ceil(s.secondsLeft);
      const w = 60;
      const c0 = (COLS - w) / 2;
      box(text, c0, 34, w, 5, blink(t, 1.5) ? 'yellow' : 'fg');
      const label = '[ENTER]  START NOW';
      text.writeScaled((COLS - [...label].length * 1.5) / 2, 35.1, label, 1.5, 'yellow');
      centered(text, 37.2, `NEXT: ${s.kind === 'private' ? 'YOUR INVITE LINK' : 'FINDING AN OPPONENT'}`, 'dim');
      const msg = `AUTO-START IN ${secs}S`;
      text.writeScaled((COLS - [...msg].length * 1.4) / 2, 39.6, msg, 1.4, secs <= 5 && blink(t, 3) ? 'yellow' : 'fg');
      const n = Math.round((s.secondsLeft / AUTO_SECONDS) * (w - 2));
      put(text, c0, 42, `[${'#'.repeat(n)}${'-'.repeat(w - 2 - n)}]`, secs <= 5 ? 'yellow' : 'dim');
    },
    onKey(e) {
      if (e.key === 'Enter') flow.confirm();
    },
  };
}
