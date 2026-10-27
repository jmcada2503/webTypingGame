/**
 * How many letters of `word` the typed text matches, or 0 if it isn't a prefix.
 * Single source of truth for Targets: the view uses it to highlight, the game uses it to decide hits,
 * so green letters never disagree with what destroys a Word bullet.
 * Rule: case-insensitive, exact letters (ñ ≠ n, á ≠ a), Unicode-normalized (NFC).
 */
export function matchPrefix(typed: string, word: string): number {
  if (typed.length === 0) return 0;
  const t = typed.normalize('NFC').toLowerCase();
  const w = word.normalize('NFC').toLowerCase();
  return w.startsWith(t) ? [...t].length : 0;
}
