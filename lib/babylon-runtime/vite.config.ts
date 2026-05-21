import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "player"),
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@babylon-runtime": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4200,
  },
});
