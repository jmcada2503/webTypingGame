import { describe, expect, it } from 'vitest';
import enDenylist from '../../scripts/wordlists/denylist/en.txt?raw';
import esDenylist from '../../scripts/wordlists/denylist/es.txt?raw';
import { LANGUAGES, TIERS, TIER_LENGTHS, loadTier, loadWordList, type Language, type Tier } from './wordLists';

const DENYLIST: Record<Language, string> = { en: enDenylist, es: esDenylist };

/** Typeable letters per language: no ü in Spanish on purpose (hard to type). */
const LETTERS: Record<Language, RegExp> = {
  en: /^[a-z]+$/,
  es: /^[a-zñáéíóú]+$/,
};

/** Floors, well under the current build, so a broken build or over-eager filter fails. */
const MIN_SIZE: Record<Language, Record<Tier, number>> = {
  en: { short: 1200, medium: 4500, long: 4500 },
  es: { short: 800, medium: 5000, long: 6500 },
};

function parseWordFile(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.split('#')[0].trim().toLowerCase().normalize('NFC'))
    .filter((w) => w.length > 0);
}

describe.each(LANGUAGES)('%s word list', (language) => {
  it.each(TIERS)('%s tier is big enough and has only words of its length', async (tier) => {
    const words = await loadTier(language, tier);
    const { min, max } = TIER_LENGTHS[tier];
    expect(words.length).toBeGreaterThanOrEqual(MIN_SIZE[language][tier]);
    expect(words.filter((w) => [...w].length < min || [...w].length > max)).toEqual([]);
  });

  it('is lowercase NFC with only typeable letters', async () => {
    const list = await loadWordList(language);
    const bad = TIERS.flatMap((t) => list[t]).filter(
      (w) => w !== w.normalize('NFC') || !LETTERS[language].test(w),
    );
    expect(bad).toEqual([]);
  });

  it('has no duplicates across tiers', async () => {
    const list = await loadWordList(language);
    const all = TIERS.flatMap((t) => list[t]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('has none of the denylisted words', async () => {
    const list = await loadWordList(language);
    const all = new Set(TIERS.flatMap((t) => list[t]));
    const denied = parseWordFile(DENYLIST[language]);
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.filter((w) => all.has(w))).toEqual([]);
  });

  it('loads once and shares the result', async () => {
    expect(await loadWordList(language)).toBe(await loadWordList(language));
  });
});

describe('Spanish word list', () => {
  it('keeps accents and ñ', async () => {
    const list = await loadWordList('es');
    const all = new Set(TIERS.flatMap((t) => list[t]));
    for (const w of ['también', 'más', 'año', 'niño', 'canción']) expect(all.has(w)).toBe(true);
  });

  it('drops unaccented typos of accented words', async () => {
    const list = await loadWordList('es');
    const all = new Set(TIERS.flatMap((t) => list[t]));
    for (const w of ['linea', 'ademas', 'futbol']) expect(all.has(w)).toBe(false);
  });
});
