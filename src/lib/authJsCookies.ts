import { cookies } from "next/headers";

// Auth.js v5 sets a varying set of cookies (session-token, csrf-token,
// callback-url, pkce.code_verifier, state, nonce, plus chunked variants
// like session-token.0, .1) under three name prefixes. Match by prefix so
// future cookies and chunked variants are wiped without code changes.
const AUTHJS_COOKIE_PREFIXES = [
  "authjs.",
  "__Secure-authjs.",
  "__Host-authjs.",
];

/** Clear every Auth.js cookie set on the current request. Used by both
 *  `oauth-complete` (after sp_token is minted) and `/api/auth/logout`. */
export async function clearAuthJsCookies(): Promise<void> {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (AUTHJS_COOKIE_PREFIXES.some((p) => cookie.name.startsWith(p))) {
      store.delete(cookie.name);
    }
  }
}
