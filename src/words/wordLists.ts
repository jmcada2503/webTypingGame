/**
 * Word lists per language, split into length tiers. Used by Practice and the Attack-word source.
 * Each language is its own lazily loaded chunk; build: scripts/wordlists/build_wordlists.py.
 */

export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const TIERS = ['short', 'medium', 'long'] as const;
export type Tier = (typeof TIERS)[number];

/** Letter count each tier holds, inclusive. */
export const TIER_LENGTHS: Readonly<Record<Tier, { min: number; max: number }>> = {
  short: { min: 2, max: 4 },
  medium: { min: 5, max: 7 },
  long: { min: 8, max: 20 },
};

/** Lowercase NFC words; each tier is in frequency order, most common first. */
export type WordList = Readonly<Record<Tier, readonly string[]>>;

const imports: Record<Language, () => Promise<{ default: WordList }>> = {
  en: () => import('./en.json'),
  es: () => import('./es.json'),
};

const cache = new Map<Language, Promise<WordList>>();

/** Loads a language's word list once; later calls share the same result. */
export function loadWordList(language: Language): Promise<WordList> {
  let list = cache.get(language);
  if (!list) {
    list = imports[language]().then((m) => m.default);
    // A failed load (e.g. offline) shouldn't stick: let the next call retry.
    list.catch(() => cache.delete(language));
    cache.set(language, list);
  }
  return list;
}

/** The words of one tier of a language. */
export async function loadTier(language: Language, tier: Tier): Promise<readonly string[]> {
  return (await loadWordList(language))[tier];
}
