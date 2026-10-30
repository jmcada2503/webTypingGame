import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { renderPage } from './src/seo/html';
import { SITE, languageFromPath, sitemapXml } from './src/seo/pages';

const ROBOTS = `User-agent: *\nAllow: /\nDisallow: /sandbox/\n\nSitemap: ${SITE}/sitemap.xml\n`;

/**
 * The two crawlable pages from one template (`index.html`): English at `/`, Spanish at `/es/`, plus
 * `sitemap.xml` and `robots.txt`. In dev, `/es/` falls back to the same template and gets the Spanish head.
 */
export function seoPages(): Plugin {
  let outDir = 'dist';
  let template: string | null = null;
  const isGamePage = (path: string) => !path.startsWith('/sandbox/');
  return {
    name: 'seo-pages',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const body = req.url === '/sitemap.xml' ? sitemapXml() : req.url === '/robots.txt' ? ROBOTS : null;
        if (body === null) return next();
        res.setHeader('Content-Type', req.url.endsWith('.xml') ? 'application/xml' : 'text/plain');
        res.end(body);
      });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!isGamePage(ctx.path)) return html;
        if (ctx.server) return renderPage(html, languageFromPath(new URL(ctx.originalUrl ?? '/', 'http://x').pathname));
        template = html; // build: the final page, script tags included; the Spanish copy is written below
        return renderPage(html, 'en');
      },
    },
    writeBundle() {
      if (!template) throw new Error('seo-pages: index.html was never transformed');
      mkdirSync(join(outDir, 'es'), { recursive: true });
      writeFileSync(join(outDir, 'es', 'index.html'), renderPage(template, 'es'));
      writeFileSync(join(outDir, 'sitemap.xml'), sitemapXml());
      writeFileSync(join(outDir, 'robots.txt'), ROBOTS);
    },
  };
}
