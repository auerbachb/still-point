export const OAUTH_PROVIDERS = ["google", "apple"] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Widened union: OAuth providers + email/password. */
export const AUTH_PROVIDERS = [...OAUTH_PROVIDERS, "password"] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const STORAGE_KEY = "stillpoint_last_auth_provider";

/** Narrow guard: only OAuth providers (unchanged from #337). */
export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Broad guard: any supported auth provider, including "password". */
export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === "string" && (AUTH_PROVIDERS as readonly string[]).includes(value);
}

export function loadLastAuthProvider(): AuthProvider | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isAuthProvider(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastAuthProvider(provider: AuthProvider): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, provider);
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
}
