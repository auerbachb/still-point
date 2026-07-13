import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // keep stale agent worktree checkouts and service packages out of local runs
    exclude: [...configDefaults.exclude, "**/.claude/**", "services/**"],
  },
});
