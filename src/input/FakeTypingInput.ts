import type { TypingInput } from './TypingInput';

/** A TypingInput the tests drive by hand: `type()`, then `enter()` like the hidden text field does. */
export class FakeTypingInput implements TypingInput {
  typedWord = '';
  enabled = true;
  private change = new Set<(w: string) => void>();
  private submit = new Set<(w: string) => void>();
  onChange(cb: (w: string) => void) {
    this.change.add(cb);
    return () => void this.change.delete(cb);
  }
  onSubmit(cb: (w: string) => void) {
    this.submit.add(cb);
    return () => void this.submit.delete(cb);
  }
  clear() {
    this.typedWord = '';
  }
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.clear();
  }
  dispose() {}
  type(word: string) {
    this.typedWord = word;
    this.change.forEach((cb) => cb(word));
  }
  enter() {
    const word = this.typedWord;
    this.submit.forEach((cb) => cb(word));
    this.type('');
  }
  /** Types a whole word and submits it. */
  say(word: string) {
    this.type(word);
    this.enter();
  }
}
