/** The slice of `window` the check reads (so it can be tested without a browser). */
export interface PointerEnv {
  matchMedia(query: string): { matches: boolean };
  navigator: { maxTouchPoints: number };
}

/**
 * True on a phone or tablet with no mouse or trackpad: the primary pointer is coarse (a finger) and no fine pointer
 * is attached. A touch laptop still reports a fine pointer (its trackpad), so it is not blocked. Not proof there is
 * no keyboard (an iPad with only a Bluetooth keyboard looks the same), so the block screen lifts on a real key press.
 */
export function isTouchOnly(env: PointerEnv): boolean {
  const q = (query: string) => env.matchMedia(query).matches;
  return env.navigator.maxTouchPoints > 0 && q('(pointer: coarse)') && !q('(any-pointer: fine)');
}
