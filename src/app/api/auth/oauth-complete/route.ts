import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth-config";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createToken, setAuthCookie } from "@/lib/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.still-point.me";

// Auth.js v5 sets a varying set of cookies (session-token, csrf-token,
// callback-url, pkce.code_verifier, state, nonce, plus chunked variants
// like session-token.0, .1) under three name prefixes. Match by prefix so
// future cookies and chunked variants are wiped without code changes.
const AUTHJS_COOKIE_PREFIXES = [
  "authjs.",
  "__Secure-authjs.",
  "__Host-authjs.",
];

async function clearAuthJsCookies() {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (AUTHJS_COOKIE_PREFIXES.some((p) => cookie.name.startsWith(p))) {
      store.delete(cookie.name);
    }
  }
}

/** Bridge from an Auth.js OAuth session to our long-lived sp_token cookie.
 *  After Auth.js completes the provider callback, redirect callback in
 *  auth-config sends the user here; we mint sp_token and drop the Auth.js
 *  session so the SPA's existing /api/auth/me path is the only auth source. */
export async function GET() {
  let redirectPath = "/app";

  try {
    const session = await auth();
    const userId = session?.userId;

    if (!userId) {
      redirectPath = "/app?error=oauth_session_missing";
    } else {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        redirectPath = "/app?error=oauth_user_missing";
      } else {
        const token = await createToken({ userId: user.id, email: user.email });
        await setAuthCookie(token);
      }
    }
  } catch (error) {
    console.error("oauth-complete bridge error:", error);
    redirectPath = "/app?error=oauth_internal_error";
  } finally {
    // Always clear Auth.js cookies — on success because sp_token is now the
    // canonical session, on failure to avoid leaving the user pinned to a
    // half-completed Auth.js session that would loop them through the
    // bridge again.
    await clearAuthJsCookies();
  }

  return NextResponse.redirect(new URL(redirectPath, APP_URL));
}
