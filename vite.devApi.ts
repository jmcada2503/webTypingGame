import type { Plugin } from 'vite';
import { MemoryStore } from './infra/lambda/api/memoryStore';
import { MemoryPresenceStore, Presence } from './infra/lambda/api/presence';
import { createRouter } from './infra/lambda/api/routes';
import { Matchmaker } from './infra/lambda/api/service';

/**
 * `npm run dev` only: serves `/api/*` from the real matchmaking code over the in-memory store, so two local
 * tabs can find each other and play online with no AWS. `/status.json` is absent (servers open).
 */
export function devApi(): Plugin {
  const route = createRouter(new Matchmaker(new MemoryStore()), new Presence(new MemoryPresenceStore(), { log: () => {} }));
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/status.json') {
          res.statusCode = 404;
          return res.end();
        }
        if (!url.pathname.startsWith('/api/')) return next();
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const text = Buffer.concat(chunks).toString();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : undefined;
        } catch {
          body = Symbol('invalid');
        }
        const out = await route({ method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body });
        res.statusCode = out.status;
        res.setHeader('content-type', 'application/json');
        for (const [name, value] of Object.entries(out.headers ?? {})) res.setHeader(name, value);
        res.end(JSON.stringify(out.body));
      });
    },
  };
}
