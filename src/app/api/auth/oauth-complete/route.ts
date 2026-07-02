import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth-config";
import { clearAuthJsCookies } from "@/lib/authJsCookies";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createToken, setAuthCookie } from "@/lib/auth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { isOAuthProvider } from "@/lib/lastAuthProvider";

/** Sanitize a `?return=` param into a same-origin path. Anything other
 *  than a leading single `/` (no protocol-relative `//`, no full URL) is
 *  rejected to prevent open-redirect via the bridge. */
function sanitizeReturnTarget(raw: string | null): string {
  if (!raw) return "/app";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

/** Bridge from an Auth.js OAuth session to our long-lived sp_token cookie.
 *  After Auth.js completes the provider callback, the redirect callback in
 *  auth-config sends the user here; we mint sp_token and drop the Auth.js
 *  session so the SPA's existing /api/auth/me path is the only auth source.
 *
 *  Redirects use the inbound `request.url` as the base so the sp_token
 *  cookie (set on the request host) is sent on the redirect — using a
 *  fixed canonical APP_URL would cross hosts on previews/localhost and
 *  drop the cookie. */
export const GET = withApiHandler("oauth-complete bridge", async (request: NextRequest) => {
  const requestUrl = new URL(request.url);
  const successTarget = sanitizeReturnTarget(requestUrl.searchParams.get("return"));
  let errorPath: string | null = null;
  let completedProvider: string | null = null;

  try {
    const session = await auth();
    const userId = session?.userId;
    completedProvider = session?.authProvider ?? null;

    if (!userId) {
      errorPath = "/app?error=oauth_session_missing";
    } else {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) {
        errorPath = "/app?error=oauth_user_missing";
      } else {
        const token = await createToken({ userId: user.id, email: user.email });
        await setAuthCookie(token);
      }
    }
  } catch (error) {
    console.error("oauth-complete bridge error:", error);
    errorPath = "/app?error=oauth_internal_error";
  } finally {
    // Always clear Auth.js cookies — on success because sp_token is now
    // the canonical session, on failure to avoid leaving the user pinned
    // to a half-completed Auth.js session that would loop them through
    // the bridge again. Best-effort: a thrown error here must not prevent
    // the redirect below from running.
    try {
      await clearAuthJsCookies();
    } catch (cookieError) {
      console.error("oauth-complete cookie cleanup failed:", cookieError);
    }
  }

  const finalUrl = new URL(errorPath ?? successTarget, request.url);
  // Only on success: tell the client which provider just completed so it
  // can record the "last used" login method (#337). Allowlisted so an
  // unexpected provider string never lands in the redirect URL.
  if (!errorPath && isOAuthProvider(completedProvider)) {
    finalUrl.searchParams.set("auth_provider", completedProvider);
  }
  return NextResponse.redirect(finalUrl);
});
