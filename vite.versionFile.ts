import type { Plugin } from 'vite';
import { listVersion } from './src/net/identity';
import en from './src/words/en.json';
import es from './src/words/es.json';

/**
 * `npm run build` only: writes `/version.json` with each language's `listVersion` (word-list hash + Attack-word
 * picker version). It deploys with the pages (no-cache); a tab left open across a deploy compares it with its
 * own before joining and reloads if it's behind (`src/net/freshness.ts`).
 */
export function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ en: listVersion(en), es: listVersion(es) }) });
    },
  };
}
