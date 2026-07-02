import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createToken, SP_TOKEN_COOKIE } from "@/lib/auth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { resolveOAuthUserId, OAuthEmailRequiredError } from "@/lib/oauth-user-resolution";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
// Google issues ID tokens with `iss` as either form; accept both.
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/**
 * Accepted audiences for the native Google ID token. The iOS Google Sign-In SDK
 * mints an ID token whose `aud` is the iOS OAuth client ID (`AUTH_GOOGLE_IOS_CLIENT_ID`);
 * when the app is configured with a `serverClientID`, `aud` is the web client ID
 * (`AUTH_GOOGLE_ID`) instead. Accept whichever client IDs are configured so either
 * native setup verifies cleanly.
 */
function googleAudiences(): string[] {
  return [process.env.AUTH_GOOGLE_IOS_CLIENT_ID, process.env.AUTH_GOOGLE_ID]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

type RequestBody = {
  idToken?: string;
  // Optional; included for parity with Google's API and future server-side token
  // exchange. Not used for account linking today.
  serverAuthCode?: string;
};

export const POST = withApiHandler("google-native", async (request: NextRequest) => {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idToken = typeof body.idToken === "string" ? body.idToken : "";
  if (!idToken) {
    return NextResponse.json({ error: "idToken required" }, { status: 400 });
  }

  const audiences = googleAudiences();
  if (audiences.length === 0) {
    console.error(
      "google-native: no Google client IDs configured (set AUTH_GOOGLE_IOS_CLIENT_ID and/or AUTH_GOOGLE_ID)",
    );
    return NextResponse.json({ error: "Google sign-in is not configured" }, { status: 500 });
  }

  let sub: string;
  let emailFromToken: string | undefined;
  let nameFromToken: string | null = null;
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ISSUERS,
      audience: audiences,
    });
    if (typeof payload.sub !== "string" || !payload.sub) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    sub = payload.sub;
    const emailClaim = payload.email;
    if (typeof emailClaim === "string" && emailClaim.trim()) {
      // Match web Google parity (src/lib/auth-config.ts): treat the email as
      // verified unless Google explicitly says it is not.
      const ev = payload.email_verified;
      if (ev === false || ev === "false") {
        return NextResponse.json({ error: "Email not verified" }, { status: 401 });
      }
      emailFromToken = emailClaim.trim().toLowerCase();
    }
    if (typeof payload.name === "string" && payload.name.trim()) {
      nameFromToken = payload.name.trim();
    }
  } catch {
    return NextResponse.json({ error: "Invalid identity token" }, { status: 401 });
  }

  let userId: string;
  try {
    userId = await resolveOAuthUserId({
      provider: "google",
      providerAccountId: sub,
      email: emailFromToken,
      profile: { name: nameFromToken },
    });
  } catch (error) {
    if (error instanceof OAuthEmailRequiredError) {
      return NextResponse.json(
        { error: "Email required for first sign-in with this Google account" },
        { status: 400 },
      );
    }
    console.error("google-native user resolution error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 500 });
  }

  const token = await createToken({ userId: user.id, email: user.email });
  const res = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      isPublic: user.isPublic,
      currentDay: user.currentDay,
      aphorismsEnabled: user.aphorismsEnabled,
      attentionTrackingEnabled: user.attentionTrackingEnabled,
    },
    token,
  });
  res.cookies.set(SP_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
});
