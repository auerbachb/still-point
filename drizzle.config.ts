import fs from "fs";
import path from "path";
import { defineConfig } from "drizzle-kit";

/** Drizzle CLI does not load Next.js env files; mirror common local setup. */
function loadEnvFile(relPath: string): void {
  const full = path.join(process.cwd(), relPath);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith("export ")) {
      key = key.slice(7).trim();
    }
    let val = trimmed.slice(eq + 1).trim();
    const quote = val[0];
    if (quote === '"' || quote === "'") {
      const close = val.lastIndexOf(quote);
      if (close <= 0) continue;
      val = val.slice(1, close);
    } else {
      val = val.replace(/\s+#.*$/, "").trim();
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
});
