// The page address follows the language: / is English, /es/ Spanish (two crawlable pages, one game).
import type { ScreenFlow } from '../flow/ScreenFlow';
import type { Language } from '../flow/types';
import { languageFromPath, pageMeta, pathFor } from '../seo/pages';

const show = (lang: Language) => {
  document.documentElement.lang = lang;
  document.title = pageMeta(lang).title;
};

/**
 * The address sets the language on load. Switching it in the menu (Tab) moves to the other page's address without
 * reloading; Back and Forward switch it again while the menu is up.
 */
export function syncLanguageWithAddress(flow: ScreenFlow) {
  let shown = languageFromPath(location.pathname);
  flow.setLanguage(shown);
  flow.onChange(() => {
    const lang = flow.language();
    if (lang === shown) return;
    shown = lang;
    history.pushState(null, '', pathFor(lang) + location.search + location.hash);
    show(lang);
  });
  addEventListener('popstate', () => {
    const lang = languageFromPath(location.pathname);
    if (lang === shown || flow.state().screen !== 'menu') return;
    shown = lang;
    flow.setLanguage(lang);
    show(lang);
  });
}
