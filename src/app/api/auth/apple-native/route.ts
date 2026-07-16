import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createToken, SP_TOKEN_COOKIE } from "@/lib/auth";
import { verifyAppleJwt } from "@/lib/apple-auth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { resolveOAuthUserId, OAuthEmailRequiredError } from "@/lib/oauth-user-resolution";

type AppleUserPayload = {
  name?: { firstName?: string; lastName?: string };
  email?: string;
};

type RequestBody = {
  identityToken?: string;
  authorizationCode?: string;
  rawNonce?: string;
  user?: AppleUserPayload;
};

function displayNameFromAppleUser(u: AppleUserPayload | undefined): string | null {
  if (!u?.name) return null;
  const { firstName = "", lastName = "" } = u.name;
  const combined = `${firstName} ${lastName}`.trim();
  return combined || null;
}

export const POST = withApiHandler("apple-native", async (request: NextRequest) => {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const identityToken = typeof body.identityToken === "string" ? body.identityToken : "";
  if (!identityToken) {
    return NextResponse.json({ error: "identityToken required" }, { status: 400 });
  }

  const rawNonce = typeof body.rawNonce === "string" ? body.rawNonce : "";
  if (!rawNonce) {
    return NextResponse.json({ error: "rawNonce required" }, { status: 400 });
  }

  let sub: string;
  let emailFromToken: string | undefined;
  try {
    const payload = await verifyAppleJwt(identityToken, { expectedNonce: rawNonce });
    if (typeof payload.sub !== "string" || !payload.sub) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    sub = payload.sub;
    const emailClaim = payload.email;
    if (typeof emailClaim === "string" && emailClaim.trim()) {
      emailFromToken = emailClaim.trim().toLowerCase();
      const ev = payload.email_verified;
      if (ev !== true && ev !== "true") {
        return NextResponse.json({ error: "Email not verified" }, { status: 401 });
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid identity token" }, { status: 401 });
  }

  const emailForResolution = emailFromToken;

  const fromApple = displayNameFromAppleUser(body.user);
  const nameForProfile = fromApple;

  let userId: string;
  try {
    userId = await resolveOAuthUserId({
      provider: "apple",
      providerAccountId: sub,
      email: emailForResolution,
      profile: { name: nameForProfile },
    });
  } catch (error) {
    if (error instanceof OAuthEmailRequiredError) {
      return NextResponse.json(
        { error: "Email required for first sign-in with this Apple ID" },
        { status: 400 },
      );
    }
    console.error("apple-native user resolution error:", error);
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
