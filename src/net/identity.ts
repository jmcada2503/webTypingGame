import { ATTACK_PICKER_VERSION } from '../match/attackWords';
import { TIERS, type WordList } from '../words/wordLists';

const PID_KEY = 'typing-game.player-id';

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The player's anonymous id: random, kept in this browser (no names, no accounts). If storage is blocked
 * (private window, disabled cookies) it lasts for the tab only.
 */
export function playerId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): string {
  try {
    const known = storage?.getItem(PID_KEY);
    if (known && /^[A-Za-z0-9_-]{16,64}$/.test(known)) return known;
    const id = randomId();
    storage?.setItem(PID_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Which words and which Attack-word picker this build uses. Both players must match, or honest Shots fail
 * the opponent's check: the hash of the list (FNV-1a over every word, in order) plus `ATTACK_PICKER_VERSION`.
 */
export function listVersion(list: WordList): string {
  let hash = 0x811c9dc5;
  for (const tier of TIERS) {
    for (const word of [tier, ...list[tier]]) {
      for (let i = 0; i < word.length; i++) hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193);
      hash = Math.imul(hash ^ 0x0a, 0x01000193);
    }
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}-p${ATTACK_PICKER_VERSION}`;
}
