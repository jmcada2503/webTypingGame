import { defineConfig } from "vitest/config";
import { devApi } from "./vite.devApi";
import { seoPages } from "./vite.seoPages";
import { versionFile } from "./vite.versionFile";

// The game at / (and its Spanish page /es/, written by seoPages) and the visual sandbox (tweak panel) at /sandbox/.
export default defineConfig({
  // `npm run dev`: /api served by the real matchmaking code over the in-memory store (no AWS).
  // `npm run build`: /version.json, so tabs left open across a deploy reload before joining.
  // Both: the English (/) and Spanish (/es/) pages from index.html, sitemap.xml, robots.txt.
  plugins: [devApi(), versionFile(), seoPages()],
  build: {
    rollupOptions: { input: { main: "index.html", sandbox: "sandbox/index.html" } },
  },
  // Other checkouts live under .claude/ (agent worktrees): changes there must not reload the page being tested.
  server: { watch: { ignored: ["**/.claude/**"] } },
  // Other checkouts under .claude/ (agent worktrees) hold copies of the tests: skip them.
  test: { exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"] },
});
