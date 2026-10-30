// The two crawlable pages (English at /, Spanish at /es/): one game, the language set by the address.
import type { Language } from '../flow/types';

export const SITE = 'https://typewing.net';
export const LANGUAGES: Language[] = ['en', 'es'];

export interface PageMeta {
  lang: Language;
  /** Where the page lives on the site. */
  path: string;
  canonical: string;
  title: string;
  description: string;
  /** Open Graph locale (`og:locale`). */
  ogLocale: string;
  /** Every language version plus the default, the same list on both pages. */
  alternates: { hreflang: string; href: string }[];
  /** The link-preview picture (Open Graph / Twitter card). */
  image: { url: string; width: number; height: number };
}

const TEXT: Record<Language, { title: string; description: string; ogLocale: string }> = {
  en: {
    title: 'Typewing: free multiplayer typing game',
    description: 'Type the words flying at your ship to destroy them, then type your red word to fire back. A free 1v1 typing game in the browser, or practice alone.',
    ogLocale: 'en_US',
  },
  es: {
    title: 'Typewing: juego de mecanografía multijugador gratis',
    description: 'Escribe las palabras que vuelan hacia tu nave para destruirlas y tu palabra roja para disparar. Juego de mecanografía 1 contra 1 gratis en el navegador.',
    ogLocale: 'es_ES',
  },
};

export const pathFor = (lang: Language) => (lang === 'en' ? '/' : `/${lang}/`);

/** The language a page address stands for: /es/ is Spanish, everything else English. */
export function languageFromPath(path: string): Language {
  return /^\/es(\/|\/index\.html)?$/.test(path) ? 'es' : 'en';
}

/** Title, description, canonical address, language links and preview image of one page. */
export function pageMeta(lang: Language): PageMeta {
  return {
    lang,
    path: pathFor(lang),
    canonical: SITE + pathFor(lang),
    ...TEXT[lang],
    alternates: [...LANGUAGES.map((l) => ({ hreflang: l, href: SITE + pathFor(l) })), { hreflang: 'x-default', href: SITE + pathFor('en') }],
    image: { url: `${SITE}/og.jpg`, width: 1200, height: 630 },
  };
}

/** `sitemap.xml`: both pages, each with its language links (Google reads hreflang from either place). */
export function sitemapXml(): string {
  const urls = LANGUAGES.map((lang) => {
    const m = pageMeta(lang);
    const links = m.alternates.map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`);
    return ['  <url>', `    <loc>${m.canonical}</loc>`, ...links, '  </url>'].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/** schema.org data for the page: a free game played in the browser. */
export function jsonLd(lang: Language) {
  const m = pageMeta(lang);
  return {
    '@context': 'https://schema.org',
    '@type': ['VideoGame', 'WebApplication'],
    name: 'Typewing',
    url: m.canonical,
    description: m.description,
    inLanguage: lang,
    image: m.image.url,
    genre: ['Typing', 'Arcade', 'Shooter'],
    playMode: ['MultiPlayer', 'SinglePlayer'],
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any (web browser)',
    browserRequirements: 'A desktop browser and a physical keyboard',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

/** The crawlable text in each page: what the how-to screen and the menu say, as plain HTML. */
export const PAGE_TEXT: Record<Language, { intro: string; howToTitle: string; howTo: string[]; modes: string[]; keyboard: string; otherLanguage: string }> = {
  en: {
    intro: 'A free multiplayer typing game in your browser. Your ship is under attack: type fast to defend it, and type to strike back.',
    howToTitle: 'How to play',
    howTo: [
      'Defend: type the word flying at you, then press Enter to destroy it.',
      'Attack: type your red word, then press Enter to fire it at the enemy ship.',
      'Each player has 3 Lives. A word that reaches your ship costs one. Lose all 3 and the Match is over.',
      'If neither player types for 10 seconds, the Match ends in Peace.',
    ],
    modes: [
      'Practice: play alone against an endless stream of words that keeps getting faster.',
      'Public match: get matched with another player online, in English or Spanish.',
      'Private match: send an Invite link to a friend.',
    ],
    keyboard: 'Needs a computer with a physical keyboard.',
    otherLanguage: 'Jugar en español',
  },
  es: {
    intro: 'Un juego de mecanografía multijugador gratis en el navegador. Tu nave está bajo ataque: escribe rápido para defenderla y escribe para contraatacar.',
    howToTitle: 'Cómo se juega',
    howTo: [
      'Defiende: escribe la palabra que vuela hacia ti y pulsa Enter para destruirla.',
      'Ataca: escribe tu palabra roja y pulsa Enter para dispararla a la nave enemiga.',
      'Cada jugador tiene 3 vidas. Cada palabra que llega a tu nave te quita una. Si pierdes las 3, la partida termina.',
      'Si ningún jugador escribe durante 10 segundos, la partida termina en paz.',
    ],
    modes: [
      'Práctica: juega solo contra palabras sin fin que van cada vez más rápido.',
      'Partida pública: juega contra otra persona en línea, en español o en inglés.',
      'Partida privada: envía un enlace de invitación a un amigo.',
    ],
    keyboard: 'Necesitas un ordenador con teclado físico.',
    otherLanguage: 'Play in English',
  },
};
