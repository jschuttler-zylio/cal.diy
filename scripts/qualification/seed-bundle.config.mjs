import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = resolve(import.meta.dirname, "../..");
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  root,
  ssr: {
    noExternal: true,
  },
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: resolve(root, ".qualification/seed"),
    sourcemap: false,
    ssr: resolve(root, "scripts/seed-app-store.ts"),
    target: "node20",
    rollupOptions: {
      external(id) {
        return id === "@calcom/prisma" || id.startsWith("@calcom/prisma/") || nodeBuiltins.has(id);
      },
      output: {
        entryFileNames: "seed-app-store.cjs",
        format: "cjs",
        inlineDynamicImports: true,
      },
    },
  },
});
