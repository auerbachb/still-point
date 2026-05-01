import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createToken, setAuthCookie } from "@/lib/auth";
import { resolveOrCreateUserForOAuthLink } from "@/lib/oauth-account-resolution";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

/** Default matches `PRODUCT_BUNDLE_IDENTIFIER` in ios/project.yml. Override with
 *  AUTH_APPLE_NATIVE_ID when the bundle id differs (forks, other targets). */
const DEFAULT_APPLE_NATIVE_AUDIENCE = "com.brettonauerbach.stillpoint";

function audienceAccepted(aud: unknown, servicesId: string, nativeAudience: string): boolean {
  const list = Array.isArray(aud) ? aud : aud != null ? [aud] : [];
  return list.some((a) => a === servicesId || a === nativeAudience);
}

export async function POST(request: NextRequest) {
  try {
    const servicesId = process.env.AUTH_APPLE_ID?.trim();
    const nativeAudience =
      process.env.AUTH_APPLE_NATIVE_ID?.trim() || DEFAULT_APPLE_NATIVE_AUDIENCE;

    if (!servicesId) {
      return NextResponse.json({ error: "Apple sign-in is not configured" }, { status: 503 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const identityToken =
      typeof body?.identityToken === "string" ? body.identityToken.trim() : "";
    const authorizationCode =
      typeof body?.authorizationCode === "string" ? body.authorizationCode.trim() : "";

    if (!identityToken || !authorizationCode) {
      return NextResponse.json(
        { error: "identityToken and authorizationCode are required" },
        { status: 400 },
      );
    }

    // Verify signature + standard claims. Do not log tokens or codes.
    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
    });

    if (!audienceAccepted(payload.aud, servicesId, nativeAudience)) {
      return NextResponse.json({ error: "Invalid token audience" }, { status: 401 });
    }

    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) {
      return NextResponse.json({ error: "Invalid token subject" }, { status: 401 });
    }

    const rawEmail = typeof payload.email === "string" ? payload.email : null;
    if (!rawEmail) {
      return NextResponse.json(
        { error: "Email not available on this sign-in. Use Apple Settings to share email, or sign in on the web first." },
        { status: 400 },
      );
    }

    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    if (!emailVerified) {
      return NextResponse.json({ error: "Email not verified" }, { status: 401 });
    }

    const email = rawEmail.trim().toLowerCase();

    let fullName: string | null = null;
    const fn = body.fullName as Record<string, unknown> | undefined;
    if (fn && typeof fn === "object") {
      const given = typeof fn.givenName === "string" ? fn.givenName.trim() : "";
      const family = typeof fn.familyName === "string" ? fn.familyName.trim() : "";
      const combined = [given, family].filter(Boolean).join(" ").trim();
      fullName = combined.length > 0 ? combined : null;
    }

    const userId = await resolveOrCreateUserForOAuthLink({
      provider: "apple",
      providerAccountId: sub,
      email,
      profileName: fullName,
    });

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      return NextResponse.json({ error: "Account resolution failed" }, { status: 500 });
    }

    const token = await createToken({ userId: user.id, email: user.email });
    await setAuthCookie(token);

    const includeToken = request.headers.get("x-still-point-client") === "ios";

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isPublic: user.isPublic,
        currentDay: user.currentDay,
      },
      ...(includeToken ? { token } : {}),
    });
  } catch (error) {
    // Never log identityToken / authorizationCode
    console.error("Apple native sign-in error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Sign-in failed" }, { status: 401 });
  }
}
