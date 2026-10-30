import type { TextGrid } from '../render/AsciiRenderer';
import { blink, box, centered, twoTone } from './draw';

/** The block screen for phones and tablets: the game is played by typing, so it needs a physical keyboard. */
export function drawNoKeyboard(text: TextGrid, t: number) {
  twoTone(text, 8, 'KEYBOARD ', 'NEEDED', 3);
  box(text, 30, 20, 68, 11, 'dim');
  centered(text, 23, 'THIS GAME IS PLAYED BY TYPING WORDS', 'fg');
  centered(text, 25, 'IT NEEDS A PHYSICAL KEYBOARD', 'yellow');
  centered(text, 27, 'OPEN IT ON A COMPUTER, OR PAIR A KEYBOARD', 'dim');
  if (blink(t, 1)) centered(text, 37, 'HAVE A KEYBOARD? PRESS ANY KEY', 'green');
}
