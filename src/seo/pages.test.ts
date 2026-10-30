import { describe, expect, test } from 'vitest';
import { jsonLd, languageFromPath, pageMeta, sitemapXml } from './pages';

describe('the language a page address stands for', () => {
  test('/es/ is the Spanish page', () => {
    expect(languageFromPath('/es/')).toBe('es');
    expect(languageFromPath('/es')).toBe('es');
    expect(languageFromPath('/es/index.html')).toBe('es');
  });

  test('everything else is the English page', () => {
    for (const path of ['/', '/index.html', '', '/est/', '/sandbox/', '/en/']) expect(languageFromPath(path)).toBe('en');
  });
});

describe('what each page tells search engines and link previews', () => {
  test('the English page lives at the root of typewing.net', () => {
    const m = pageMeta('en');
    expect(m.path).toBe('/');
    expect(m.canonical).toBe('https://typewing.net/');
    expect(m.title).toBe('Typewing: free multiplayer typing game');
    expect(m.ogLocale).toBe('en_US');
  });

  test('the Spanish page lives at /es/ with its own title', () => {
    const m = pageMeta('es');
    expect(m.path).toBe('/es/');
    expect(m.canonical).toBe('https://typewing.net/es/');
    expect(m.title).toBe('Typewing: juego de mecanografía multijugador gratis');
    expect(m.ogLocale).toBe('es_ES');
  });

  test('both pages point at each other, with English as the default', () => {
    const expected = [
      { hreflang: 'en', href: 'https://typewing.net/' },
      { hreflang: 'es', href: 'https://typewing.net/es/' },
      { hreflang: 'x-default', href: 'https://typewing.net/' },
    ];
    expect(pageMeta('en').alternates).toEqual(expected);
    expect(pageMeta('es').alternates).toEqual(expected);
  });

  test('both share the 1200x630 preview image by its full address', () => {
    for (const lang of ['en', 'es'] as const) expect(pageMeta(lang).image).toEqual({ url: 'https://typewing.net/og.jpg', width: 1200, height: 630 });
  });

  test('descriptions fit in a search result (about 160 characters)', () => {
    for (const lang of ['en', 'es'] as const) {
      const d = pageMeta(lang).description;
      expect(d.length).toBeGreaterThan(70);
      expect(d.length).toBeLessThanOrEqual(160);
    }
  });
});

describe('the sitemap', () => {
  const xml = sitemapXml();

  test('lists both pages, each with its language links', () => {
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://typewing.net/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://typewing.net/"/>
    <xhtml:link rel="alternate" hreflang="es" href="https://typewing.net/es/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://typewing.net/"/>
  </url>
  <url>
    <loc>https://typewing.net/es/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="https://typewing.net/"/>
    <xhtml:link rel="alternate" hreflang="es" href="https://typewing.net/es/"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://typewing.net/"/>
  </url>
</urlset>
`);
  });
});

describe('structured data (JSON-LD)', () => {
  test('describes a free browser game in the page language', () => {
    const d = jsonLd('es');
    expect(d['@context']).toBe('https://schema.org');
    expect(d['@type']).toEqual(['VideoGame', 'WebApplication']);
    expect(d.name).toBe('Typewing');
    expect(d.url).toBe('https://typewing.net/es/');
    expect(d.inLanguage).toBe('es');
    expect(d.description).toBe(pageMeta('es').description);
    expect(d.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
    expect(d.playMode).toEqual(['MultiPlayer', 'SinglePlayer']);
    expect(d.applicationCategory).toBe('GameApplication');
  });

  test('the English page names its own address and language', () => {
    expect(jsonLd('en').url).toBe('https://typewing.net/');
    expect(jsonLd('en').inLanguage).toBe('en');
  });
});
