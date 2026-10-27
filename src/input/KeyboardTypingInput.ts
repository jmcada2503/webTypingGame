import type { TypingInput } from './TypingInput';

const MAX_LENGTH = 20;
const NOT_LETTER = /[^\p{L}]/gu;
const FORM_FIELD = 'input, textarea, select, [contenteditable]';

/**
 * TypingInput backed by a hidden, always-focused text field. The browser composes accents
 * there (dead keys: ´ + a → á, ¨ + u → ü, Option+n → ñ), which raw keydown events can't do
 * on a page with no focused field. Space submits; non-letters are dropped; text is lowercased.
 * Leaves focus alone while another form field (e.g. the sandbox panel) is being edited.
 */
export class KeyboardTypingInput implements TypingInput {
  private word = '';
  private enabled = true;
  private composing = false;
  private readonly field = document.createElement('input');
  private readonly changeCbs = new Set<(typedWord: string) => void>();
  private readonly submitCbs = new Set<(word: string) => void>();

  constructor(root: HTMLElement = document.body) {
    const f = this.field;
    f.type = 'text';
    f.autocomplete = 'off';
    f.spellcheck = false;
    f.setAttribute('autocapitalize', 'off');
    f.setAttribute('autocorrect', 'off');
    f.setAttribute('aria-label', 'Typed word');
    f.dataset.typingInput = '';
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    root.append(f);

    f.addEventListener('keydown', this.onFieldKey);
    f.addEventListener('compositionstart', this.onCompositionStart);
    f.addEventListener('compositionend', this.onCompositionEnd);
    f.addEventListener('input', this.onInput);
    window.addEventListener('keydown', this.onWindowKey, true);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('focus', this.focus);
    this.focus();
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
    this.field.value = '';
    this.set('');
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.field.disabled = !enabled;
    if (enabled) this.focus();
    else this.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this.onWindowKey, true);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('focus', this.focus);
    this.field.remove();
    this.changeCbs.clear();
    this.submitCbs.clear();
  }

  private readonly focus = () => {
    if (!this.enabled) return;
    const active = document.activeElement;
    if (active && active !== this.field && active.matches(FORM_FIELD)) return;
    this.field.focus({ preventScroll: true });
  };

  private set(word: string) {
    if (word === this.word) return;
    this.word = word;
    this.changeCbs.forEach((cb) => cb(word));
  }

  /** Field value → Typed word: letters only, NFC, lowercase, max length. Writes the cleaned text back. */
  private sync() {
    const clean = [...this.field.value.normalize('NFC').toLowerCase().replace(NOT_LETTER, '')]
      .slice(0, MAX_LENGTH)
      .join('');
    if (this.field.value !== clean) this.field.value = clean;
    this.set(clean);
  }

  private submit() {
    if (this.word === '') return;
    const word = this.word;
    this.submitCbs.forEach((cb) => cb(word));
    this.clear();
  }

  private readonly onFieldKey = (e: KeyboardEvent) => {
    if (e.key === ' ' && !e.isComposing && !this.composing) {
      e.preventDefault();
      this.submit();
    }
  };

  private readonly onCompositionStart = () => {
    this.composing = true;
  };

  private readonly onCompositionEnd = () => {
    this.composing = false;
    this.sync();
  };

  private readonly onInput = (e: Event) => {
    // Mid-composition the field holds the pending accent mark; wait for compositionend.
    if (this.composing || (e as InputEvent).isComposing) return;
    this.sync();
  };

  /** First key after focus wandered off (e.g. a panel click): pull focus back so the key lands in the field. */
  private readonly onWindowKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (document.activeElement !== this.field) this.focus();
  };

  private readonly onPointerDown = (e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.(FORM_FIELD)) return;
    // Let the click finish (it may blur the field) before taking focus back.
    setTimeout(this.focus, 0);
  };
}
