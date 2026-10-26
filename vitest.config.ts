import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { PGLITE_TEST_FILES } from "./src/lib/testing/pgliteTestFiles";

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
    // Files that boot PGlite run as their own project (#733,
    // docs/issues/733-pglite-test-flake.md): a cold boot inside a test or hook
    // outruns the 5s/10s defaults once the CPU is busy, and the suite's own
    // parallel boots are a large part of what keeps it busy.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: PGLITE_TEST_FILES,
        },
      },
      {
        extends: true,
        test: {
          name: "pglite",
          include: PGLITE_TEST_FILES,
          // Room for a cold boot on a loaded machine; a hung test still fails.
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // At most 4 boots at once, and never more workers than Vitest's
          // default (one fewer than the available cores).
          maxWorkers: Math.min(4, Math.max(availableParallelism() - 1, 1)),
          // Vitest 4 rejects projects that differ in maxWorkers but share a
          // groupOrder, and runs the groups in turn: this one after `unit`.
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
