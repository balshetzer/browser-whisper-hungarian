import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the build works under a GitHub Pages project path.
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 26000,
  },
});
