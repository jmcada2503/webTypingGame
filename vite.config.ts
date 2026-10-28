import { defineConfig } from "vite";

// Until the real app entry exists, the deployed site is the visual sandbox.
export default defineConfig({
  build: {
    rollupOptions: { input: "sandbox/index.html" },
  },
});
