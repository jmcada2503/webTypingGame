import { defineConfig } from "vitest/config";

// Two pages: the game at / and the visual sandbox (tweak panel) at /sandbox/.
export default defineConfig({
  build: {
    rollupOptions: { input: { main: "index.html", sandbox: "sandbox/index.html" } },
  },
  // Other checkouts live under .claude/ (agent worktrees): changes there must not reload the page being tested.
  server: { watch: { ignored: ["**/.claude/**"] } },
  // Other checkouts under .claude/ (agent worktrees) hold copies of the tests: skip them.
  test: { exclude: ["**/node_modules/**", "**/dist/**", ".claude/**"] },
});
