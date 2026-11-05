import type { SoundRow } from '../audio/soundEditing';
import { SOUND_ROWS } from '../audio/soundEditing';
import type { SoundSettings } from '../audio/soundSettings';
import type { PaletteColor, TextGrid } from '../render/AsciiRenderer';
import { COLS, blink, box, put } from './draw';

const LABELS: Record<SoundRow, string> = { master: 'MASTER', effects: 'EFFECTS', music: 'MUSIC', keyClicks: 'KEY CLICKS' };
const BAR_CELLS = 24;
const percent = (v: number) => Math.round(v * 100);
const bar = (v: number) => {
  const full = Math.round(v * BAR_CELLS);
  return `[${'#'.repeat(full)}${'-'.repeat(BAR_CELLS - full)}]`;
};

/** Sound is off when muted or the master is at 0. */
export const soundIsOff = (s: SoundSettings) => s.muted || s.master === 0;

/** The menu's top left: the quick mute key, and below it the way into the panel (pulsing yellow, until it is open). */
export function drawSoundHints(text: TextGrid, t: number, s: SoundSettings, panelOpen: boolean) {
  const off = soundIsOff(s);
  put(text, 4, 2, off ? '[M] SOUND OFF' : `[M] MUTE   SOUND ${percent(s.master)}%`, off ? (blink(t, 1.5) ? 'red' : 'dim') : 'dim');
  if (!panelOpen) put(text, 4, 4, '[O] SOUND SETTINGS', blink(t, 1) ? 'yellow' : 'fg');
}

/** The panel over the menu: three sliders and the key clicks switch, the picked row marked. */
export function drawSoundPanel(text: TextGrid, t: number, s: SoundSettings, row: SoundRow) {
  const w = 62;
  const c0 = (COLS - w) / 2;
  const r0 = 12;
  box(text, c0, r0, w, 22, 'yellow');
  put(text, c0 + 3, r0, ' SOUND ', 'yellow');
  SOUND_ROWS.forEach((r, i) => {
    const y = r0 + 3 + i * 3;
    const on = r === row;
    const color: PaletteColor = on ? 'yellow' : 'fg';
    put(text, c0 + 3, y, on ? '>' : ' ', 'yellow');
    put(text, c0 + 5, y, LABELS[r].padEnd(11), color);
    if (r === 'keyClicks') put(text, c0 + 17, y, s.keyClicks ? '< ON  >' : '< OFF >', color);
    else {
      put(text, c0 + 17, y, bar(s[r]), on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
      put(text, c0 + 43, y, `${String(percent(s[r])).padStart(3)}%`, color);
    }
  });
  put(text, c0 + 5, r0 + 15, s.muted ? '[M] MUTED  (PRESS TO UNMUTE)' : '[M] MUTE ALL', s.muted ? 'red' : 'dim');
  put(text, c0 + 3, r0 + 18, 'J K ROW   H L CHANGE   M MUTE   Q / ESC BACK', 'dim');
}
