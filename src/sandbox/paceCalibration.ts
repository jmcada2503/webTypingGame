// PROTOTYPE ("Juice: Pace-driven motion"): the player's own Pace, measured by the Pace test page,
// taken as "fast". Kept in this browser only (localStorage); falls back to a typical value.

const KEY = 'typingGame.paceFast';
/** Default "fast" Pace (chars/s) before anyone takes the test (≈ 55 wpm). */
export const DEFAULT_FAST_PACE = 4.5;

export function loadFastPace(): { value: number; measured: boolean } {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v > 0) return { value: v, measured: true };
  } catch {
    /* storage blocked: use the default */
  }
  return { value: DEFAULT_FAST_PACE, measured: false };
}

export function saveFastPace(value: number) {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    /* storage blocked: the result is still shown on screen */
  }
}
