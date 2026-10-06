import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Next keeps `jsx: "preserve"` for its own compiler. Vitest 4 transforms with
  // oxc and ignores `esbuild.jsx`, so set the runtime here or importing a
  // `.tsx` component fails import analysis.
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // keep stale agent worktree checkouts out of local runs
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
});
