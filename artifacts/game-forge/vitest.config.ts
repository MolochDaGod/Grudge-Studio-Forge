import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: [
      // Map binary asset imports (@assets/foo.png) to a tiny string stub so
      // that modules importing them (e.g. lib/races.ts which imports race
      // portrait PNGs) can be loaded under vitest's node environment, where
      // Vite's image-asset loader isn't active.
      {
        find: /^@assets\/.+\.(png|jpe?g|gif|webp|svg|avif)$/,
        replacement: path.resolve(__dirname, "./src/__tests__/__mocks__/assetStub.ts"),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
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
