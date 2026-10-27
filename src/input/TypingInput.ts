/**
 * Typing as the game understands it, not raw keys.
 * Letters (incl. ñ and accented letters from dead keys) append, Backspace deletes,
 * Space or Enter submits. After submit callbacks run, typedWord resets to ''.
 */
export interface TypingInput {
  readonly typedWord: string;
  /** Returns an unsubscribe function. */
  onChange(cb: (typedWord: string) => void): () => void;
  /** Called with the submitted word. Returns an unsubscribe function. */
  onSubmit(cb: (word: string) => void): () => void;
  clear(): void;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}
