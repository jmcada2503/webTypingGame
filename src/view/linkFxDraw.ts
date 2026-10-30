import type { PaletteColor, TextGrid } from '../render/AsciiRenderer';
import { COLS, blink, centered, put } from '../screens/draw';
import { RESUME_SECONDS } from '../flow/types';
import { awayFrame, backFrame, hash, type LinkFx } from '../screens/linkFx';

/** Roughly where the Enemy ship is on the grid (it bobs a little). */
const SHIP = { c: 40, r: 3, w: 48, h: 14 };
const STATIC = '.:;\'`*#%@+=~';

/** Rows of static over a rectangle: `density` of cells filled, some rows jumping sideways (`slipChance`, `slipAmp`). */
function staticField(text: TextGrid, density: number, slipChance: number, slipAmp: number, t: number) {
  const frame = Math.floor(t * 18);
  const { c, r: r0, w, h } = SHIP;
  for (let r = r0 - 1; r < r0 + h + 1; r++) {
    const slip = hash(r * 7 + frame) > 1 - slipChance ? Math.round((hash(r + frame * 3) - 0.5) * slipAmp) : 0;
    for (let col = c - 4; col < c + w + 4; col++) {
      if (hash(col * 131 + r * 17 + frame * 7) < density) {
        put(text, col + slip, r, STATIC[Math.floor(hash(col * 3 + r * 5 + frame) * STATIC.length)], hash(col + r * 9 + frame * 2) > 0.8 ? 'dim' : 'fg');
      }
    }
  }
}

function bar(text: TextGrid, col: number, row: number, width: number, fraction: number, color: PaletteColor) {
  const n = Math.round(width * Math.min(1, Math.max(0, fraction)));
  put(text, col, row, '[' + '#'.repeat(n) + '-'.repeat(width - n) + ']', color);
}

/** The text of the reconnecting animation: static over the ship, the header, the RECONNECTING bar, the notes. */
export function drawAway(text: TextGrid, fx: Extract<LinkFx, { kind: 'away' }>) {
  const f = awayFrame(fx.t, fx);
  staticField(text, f.staticDensity, f.slipChance, f.slipAmp, fx.t);
  if (f.header.text === 'WEAK SIGNAL') centered(text, 1.2, blink(fx.t, 8) ? 'WEAK SIGNAL' : '', 'yellow');
  else centered(text, 1.2, blink(fx.t, 3) ? '!!  ENEMY SIGNAL LOST  !!' : '    ENEMY SIGNAL LOST    ', 'red');
  if (f.reconnecting) {
    put(text, 44, 17, 'RECONNECTING', 'yellow');
    bar(text, 58, 17, 24, f.reconnecting.fraction, 'yellow');
    put(text, 84, 17, `${f.reconnecting.seconds.toFixed(1)} s`, 'fg');
  }
  if (f.heldNote) centered(text, 18.5, 'THEIR WORD BULLETS ARE HELD IN FLIGHT. NOTHING CAN HIT YOU.', 'dim');
  centered(text, 20.2, f.lossLine.warn ? (blink(fx.t, 1.5) ? f.lossLine.text : '') : f.lossLine.text, f.lossLine.warn ? 'red' : 'dim');
}

/** Where the back-countdown's dark oval sits (the renderer draws it, behind the text and in front of the words). */
export const BACK_OVAL = { row: 24.4, radiusRows: 10.5, alpha: 0.92 };

/**
 * The back-countdown, as scaled text so it is in front of the held Word bullets: a green ENEMY BACK and the big digit
 * (red for the last 2 s) with RGB-split ghosts at the start of each second.
 */
export function drawBack(text: TextGrid, fx: Extract<LinkFx, { kind: 'back' }>) {
  const f = backFrame(fx.secondsLeft);
  const since = RESUME_SECONDS - fx.secondsLeft;
  const dust = Math.max(0, 0.45 - since * 1.2);
  if (dust > 0) staticField(text, dust, 0.07, 10, since);
  const label = f.label;
  text.writeScaled((COLS - [...label].length) / 2, 17.4, label, 1, 'green');
  if (f.digit === null) return;
  const scale = 8 - 1.2 * f.fraction;
  const s = String(f.digit);
  const c = (COLS - [...s].length * scale) / 2;
  if (f.fraction < 0.14) {
    text.writeScaled(c - 1.2, 21.2, s, scale, 'red');
    text.writeScaled(c + 1.2, 21.2, s, scale, 'green');
  }
  text.writeScaled(c, 21.2, s, scale, f.urgent ? 'red' : 'yellow');
}
