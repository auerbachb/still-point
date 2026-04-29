import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearAuthCookie } from "@/lib/auth";

// Auth.js v5 sets a varying set of cookies (session-token, csrf-token,
// callback-url, pkce.code_verifier, state, nonce, plus chunked variants
// like session-token.0, .1) under three name prefixes. Match by prefix so
// future cookies and chunked variants are wiped without code changes.
const AUTHJS_COOKIE_PREFIXES = [
  "authjs.",
  "__Secure-authjs.",
  "__Host-authjs.",
];

export async function POST() {
  await clearAuthCookie();
  // Belt-and-suspenders: clear any lingering Auth.js cookies (#136). Most
  // OAuth users only carry sp_token because oauth-complete drops the
  // Auth.js cookies on hand-off, but if the user never made it through
  // oauth-complete the session cookie can still be present here.
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (AUTHJS_COOKIE_PREFIXES.some((p) => cookie.name.startsWith(p))) {
      store.delete(cookie.name);
    }
  }
  return NextResponse.json({ ok: true });
}
