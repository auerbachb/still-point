/**
 * Ensures `POSTGRES_URL` is a well-formed `postgres(s)` URL whose host is on Neon
 * (`*.neon.tech`). This does **not** detect production vs non-production: use separate
 * credentials per environment and/or operator confirmation (e.g. `SEED_CONFIRM` on seed).
 */
export function assertNeonHostedPostgresUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("POSTGRES_URL is not a valid URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("POSTGRES_URL must use postgres:// or postgresql://.");
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(".neon.tech") && host !== "neon.tech") {
    throw new Error(
      "Refusing to use POSTGRES_URL: hostname must be a Neon host (*.neon.tech).",
    );
  }
}
