export const OAUTH_PROVIDERS = ["google", "apple"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const STORAGE_KEY = "stillpoint_last_auth_provider";

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

export function loadLastAuthProvider(): OAuthProvider | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isOAuthProvider(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastAuthProvider(provider: OAuthProvider): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, provider);
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
}
