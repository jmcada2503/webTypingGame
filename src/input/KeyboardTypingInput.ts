import type { TypingInput } from './TypingInput';

const MAX_LENGTH = 20;
const LETTER = /^\p{L}$/u;

/**
 * TypingInput from window keydown. Dead keys (´ then a → á) arrive as one composed key,
 * so they need no special handling. Ignores keys with Ctrl/⌘ held and keys typed into
 * form fields (e.g. the sandbox panel).
 */
export class KeyboardTypingInput implements TypingInput {
  private word = '';
  private enabled = true;
  private readonly changeCbs = new Set<(typedWord: string) => void>();
  private readonly submitCbs = new Set<(word: string) => void>();

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKey);
  }

  get typedWord() {
    return this.word;
  }

  onChange(cb: (typedWord: string) => void) {
    this.changeCbs.add(cb);
    return () => void this.changeCbs.delete(cb);
  }

  onSubmit(cb: (word: string) => void) {
    this.submitCbs.add(cb);
    return () => void this.submitCbs.delete(cb);
  }

  clear() {
    this.set('');
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onKey);
    this.changeCbs.clear();
    this.submitCbs.clear();
  }

  private set(word: string) {
    if (word === this.word) return;
    this.word = word;
    this.changeCbs.forEach((cb) => cb(word));
  }

  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.isComposing) return;
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;

    if (e.key === ' ') {
      e.preventDefault(); // no page scroll
      if (this.word === '') return;
      const word = this.word;
      this.submitCbs.forEach((cb) => cb(word));
      this.set('');
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      this.set([...this.word].slice(0, -1).join(''));
    } else if (LETTER.test(e.key)) {
      if ([...this.word].length >= MAX_LENGTH) return;
      this.set((this.word + e.key).normalize('NFC').toLowerCase());
    }
  };
}
