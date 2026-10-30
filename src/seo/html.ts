// Fills the page template (index.html) for one language: head tags and the crawlable text.
import type { Language } from '../flow/types';
import { PAGE_TEXT, jsonLd, pageMeta, pathFor } from './pages';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function headTags(lang: Language): string {
  const m = pageMeta(lang);
  const other = lang === 'en' ? 'es' : 'en';
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<link rel="canonical" href="${m.canonical}" />`,
    ...m.alternates.map((a) => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}" />`),
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Typewing" />`,
    `<meta property="og:url" content="${m.canonical}" />`,
    `<meta property="og:title" content="${esc(m.socialTitle)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:locale" content="${m.ogLocale}" />`,
    `<meta property="og:locale:alternate" content="${pageMeta(other).ogLocale}" />`,
    `<meta property="og:image" content="${m.image.url}" />`,
    `<meta property="og:image:width" content="${m.image.width}" />`,
    `<meta property="og:image:height" content="${m.image.height}" />`,
    `<meta property="og:image:alt" content="Typewing: an enemy ship and words flying at the cockpit" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.socialTitle)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${m.image.url}" />`,
    `<script type="application/ld+json">${JSON.stringify(jsonLd(lang))}</script>`,
  ].join('\n    ');
}

function bodyText(lang: Language): string {
  const t = PAGE_TEXT[lang];
  const other = lang === 'en' ? 'es' : 'en';
  const li = (items: string[]) => items.map((s) => `<li>${esc(s)}</li>`).join('');
  return `<main class="seo-text" lang="${lang}">
      <h1>Typewing</h1>
      <p>${esc(t.intro)}</p>
      <h2>${esc(t.howToTitle)}</h2>
      <ul>${li(t.howTo)}</ul>
      <ul>${li(t.modes)}</ul>
      <p>${esc(t.keyboard)}</p>
      <p><a href="${pathFor(other)}" hreflang="${other}">${esc(t.otherLanguage)}</a></p>
    </main>`;
}

/** The template with `<html lang>`, `<!--seo:head-->` and `<!--seo:body-->` filled for one language. */
export function renderPage(template: string, lang: Language): string {
  return template
    .replace(/<html lang="[^"]*">/, `<html lang="${lang}">`)
    .replace('<!--seo:head-->', headTags(lang))
    .replace('<!--seo:body-->', bodyText(lang));
}
