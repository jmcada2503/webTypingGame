import type { PaletteColor, TextGrid } from '../render/AsciiRenderer';

/** The fixed character grid every screen is drawn on. */
export const COLS = 128;
export const ROWS = 45;

/** Break `text` into lines of at most `width` characters on word boundaries (a longer word gets its own line). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** `mm:ss` from seconds. */
export function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** On / off at `hz` blinks per second. */
export const blink = (t: number, hz = 2) => Math.floor(t * hz) % 2 === 0;

/** Write text at a (possibly fractional) cell. */
export const put = (text: TextGrid, col: number, row: number, s: string, color?: PaletteColor) => text.write(Math.round(col), Math.round(row), s, color);

/** Write text centered horizontally on `row`. */
export const centered = (text: TextGrid, row: number, s: string, color?: PaletteColor) => put(text, (COLS - [...s].length) / 2, row, s, color);

/** Two-tone title at `scale`: `a` in white, `b` in yellow, centered on the grid (or from `col` if given). */
export function twoTone(text: TextGrid, row: number, a: string, b: string, scale: number, col: number | null = null) {
  const c0 = col ?? (COLS - ([...a].length + [...b].length) * scale) / 2;
  text.writeScaled(c0, row, a, scale, 'fg');
  text.writeScaled(c0 + [...a].length * scale, row, b, scale, 'yellow');
}

/** A `+--+` / `|` frame; the inside is blanked. */
export function box(text: TextGrid, col: number, row: number, w: number, h: number, color: PaletteColor = 'dim') {
  text.fill(col, row, w, h, ' ');
  put(text, col, row, '+' + '-'.repeat(w - 2) + '+', color);
  put(text, col, row + h - 1, '+' + '-'.repeat(w - 2) + '+', color);
  for (let r = row + 1; r < row + h - 1; r++) {
    put(text, col, r, '|', color);
    put(text, col + w - 1, r, '|', color);
  }
}
