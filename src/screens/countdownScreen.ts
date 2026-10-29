import type { PaletteColor, TextGrid } from '../render/AsciiRenderer';
import { COLS, centered, twoTone } from './draw';
import { countdownDisplay } from './content';
import type { Screen } from './Screen';

/** A huge number or word, centered. With `pulse`, red and green ghosts flank it for a moment (a color split). */
export function bigNumber(text: TextGrid, s: string, scale: number, row: number, color: PaletteColor, pulse = false) {
  const c = (COLS - [...s].length * scale) / 2;
  if (pulse) {
    text.writeScaled(c - 1.2, row, s, scale, 'red');
    text.writeScaled(c + 1.2, row, s, scale, 'green');
  }
  text.writeScaled(c, row, s, scale, color);
}

/**
 * The approved Countdown (variant A): its own black screen with a huge 5 to 1 (never 0), a color-split pulse at
 * the start of each second, and an INPUT LOCKED label. After the last second the final 1 stays while the TV
 * switches off (the effect belongs to `ScreenTransition`).
 */
export function countdownScreen(): Screen {
  return {
    draw(text, _t, s) {
      if (s.screen !== 'countdown') return;
      const d = countdownDisplay(s.secondsLeft);
      twoTone(text, 5, 'MATCH STARTS ', 'IN', 2);
      bigNumber(text, String(d.n), d.scale, 13, d.color, d.pulse);
      centered(text, 33, '[x] INPUT LOCKED', 'dim');
      centered(text, 38, s.mode === 'versus' ? 'OPPONENT CONNECTED     CLOCKS SYNCED     WORDS LOADED' : 'WORDS LOADED', 'dim');
    },
  };
}
