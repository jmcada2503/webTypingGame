import { adjustSound, moveSoundRow, type SoundRow } from '../audio/soundEditing';
import type { SoundSettings } from '../audio/soundSettings';

/** The key presses the panel reads. */
type KeyLike = Pick<KeyboardEvent, 'key'>;

/**
 * The sound settings panel over the menu: which row is picked and what the keys do. It owns every key while open
 * (so the menu behind doesn't move); `M` (quick mute) is the app's, so it works the same with the panel open.
 */
export class SoundPanel {
  private open = false;
  private picked: SoundRow = 'master';

  constructor(
    private readonly settings: () => SoundSettings,
    private readonly change: (next: SoundSettings, row: SoundRow) => void,
  ) {}

  get isOpen() {
    return this.open;
  }

  get row(): SoundRow {
    return this.picked;
  }

  /** True when the panel took the key (so the screen under it must not act on it). */
  onKey(e: KeyLike): boolean {
    if (!this.open) {
      if (e.key === 'o' || e.key === 'O') {
        this.open = true;
        this.picked = 'master';
        return true;
      }
      return false;
    }
    switch (e.key) {
      case 'q':
      case 'Q':
      case 'Escape':
      case 'o':
      case 'O':
      case 'Enter':
        this.open = false;
        break;
      case 'j':
      case 'ArrowDown':
      case 'Tab':
        this.picked = moveSoundRow(this.picked, 1);
        break;
      case 'k':
      case 'ArrowUp':
        this.picked = moveSoundRow(this.picked, -1);
        break;
      case 'l':
      case 'ArrowRight':
        this.change(adjustSound(this.settings(), this.picked, 1), this.picked);
        break;
      case 'h':
      case 'ArrowLeft':
        this.change(adjustSound(this.settings(), this.picked, -1), this.picked);
        break;
    }
    return true;
  }
}
