import type { Language } from '../flow/types';

export const VERSION_FILE = '/version.json';

/**
 * Whether this tab runs the build that is deployed now. The word lists (and the Attack-word picker) ship
 * with the code, so a tab left open across a deploy can hold old ones: paired with a fresh player, every
 * honest Shot would fail their check. The build writes `/version.json` (served no-cache) with each
 * language's `listVersion`; this compares it with ours.
 * `unknown` = no file or no answer (local dev, offline): don't block the player for it.
 */
export async function checkFreshness(
  mine: Record<Language, string>,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<'fresh' | 'stale' | 'unknown'> {
  try {
    const res = await fetchFn(VERSION_FILE, { cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const deployed = (await res.json()) as Partial<Record<Language, unknown>>;
    if (typeof deployed.en !== 'string' || typeof deployed.es !== 'string') return 'unknown';
    return deployed.en === mine.en && deployed.es === mine.es ? 'fresh' : 'stale';
  } catch {
    return 'unknown';
  }
}
