import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    server: {
      deps: {
        // quickhull3d's published ESM uses extension-less internal
        // imports (`./QuickHull`) which Node's strict ESM resolver
        // rejects. Inlining lets Vite bundle it through its own
        // (forgiving) resolver so the colliderBaker tests load.
        inline: ["quickhull3d"],
      },
    },
  },
});
