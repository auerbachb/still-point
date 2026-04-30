/** Rejects non-Neon or malformed URLs so scripts cannot target arbitrary hosts by mistake. */
export function assertNeonNonProdPostgresUrl(rawUrl: string): void {
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
      "Refusing to use POSTGRES_URL: hostname must be a Neon host (*.neon.tech). Point POSTGRES_URL at your non-production Neon branch.",
    );
  }
}
