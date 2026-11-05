import type { TextGrid } from '../render/AsciiRenderer';
import { blink, box, centered, put, twoTone } from './draw';

export type SoundChoice = 'sound' | 'silent';

const OPTIONS: { choice: SoundChoice; label: string }[] = [
  { choice: 'sound', label: 'YES, WITH SOUND' },
  { choice: 'silent', label: 'NO, PLAY SILENT' },
];

/**
 * The "play with sound?" question, shown before the menu when the browser holds the audio until a key press: the
 * answer is that key press. ← → / h l pick, Enter chooses; Y and N answer directly, Esc is no.
 */
export function soundPrompt() {
  let sel = 0;
  return {
    draw(text: TextGrid, t: number) {
      twoTone(text, 7, 'SOUND ', 'ON?', 3);
      box(text, 26, 17, 76, 21, 'dim');
      centered(text, 21, 'TYPEWING HAS SOUND EFFECTS AND MUSIC', 'fg');
      OPTIONS.forEach((o, i) => {
        const c0 = 32 + i * 34;
        const on = i === sel;
        box(text, c0, 25, 30, 5, on ? (blink(t, 3) ? 'yellow' : 'fg') : 'dim');
        put(text, c0 + (30 - o.label.length) / 2, 27, o.label, on ? 'fg' : 'dim');
      });
      centered(text, 32, '[Y] YES   [N] NO   [<- ->] MOVE   [ENTER] CHOOSE', 'fg');
      centered(text, 35, 'CHANGE IT ANY TIME: PRESS [O] FOR THE SOUND SETTINGS', 'dim');
    },
    /** The answer this key gives, if any. */
    onKey(e: KeyboardEvent): SoundChoice | null {
      const k = e.key;
      if (k === 'y' || k === 'Y') return 'sound';
      if (k === 'n' || k === 'N' || k === 'Escape') return 'silent';
      if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'h' || k === 'k') sel = 0;
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'l' || k === 'j') sel = 1;
      else if (k === 'Enter') return OPTIONS[sel].choice;
      return null;
    },
  };
}
