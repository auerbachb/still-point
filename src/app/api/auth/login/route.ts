import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, createToken, setAuthCookie } from "@/lib/auth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { wasAccountDeleted } from "@/lib/accountDeletion";
import { DELETED_ACCOUNT_MESSAGE } from "@/lib/authErrors";
import { readJsonObject } from "@/lib/readJsonObject";
import { eq } from "drizzle-orm";

const DUMMY_PASSWORD_HASH = "$2b$12$Y9nc0LdvLO3K5rJBlkE0qOAEOlfYYvCj5ra9LaWHKE9PCUvfdlUnq";

export const POST = withApiHandler("Login", async (request: NextRequest) => {
  const includeToken = request.headers.get("x-still-point-client") === "ios";
  const json = await readJsonObject(request);
  if (!json.ok) return json.response;

  const email = typeof json.body.email === "string" ? json.body.email.trim().toLowerCase() : "";
  const password = typeof json.body.password === "string" ? json.body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const [userRows, deleted] = await Promise.all([
    db.select().from(users).where(eq(users.email, email)).limit(1),
    wasAccountDeleted(email),
  ]);
  const [user] = userRows;
  if (!user) {
    if (deleted) {
      return NextResponse.json({ error: DELETED_ACCOUNT_MESSAGE }, { status: 410 });
    }
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!user.passwordHash) {
    // OAuth-only account (#136): no password ever set. Run a dummy
    // compare so timing matches the password-set path, then reject with
    // the same generic message as wrong-password / unknown-email — a
    // distinct message would let attackers enumerate which emails exist
    // AND which auth method they use.
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await createToken({ userId: user.id, email: user.email });
  await setAuthCookie(token);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      isPublic: user.isPublic,
      currentDay: user.currentDay,
      aphorismsEnabled: user.aphorismsEnabled,
      attentionTrackingEnabled: user.attentionTrackingEnabled,
      ambientSoundEnabled: user.ambientSoundEnabled,
      recoveryTargetDay: user.recoveryTargetDay,
      recoveryCurrentStep: user.recoveryCurrentStep,
      recoveryTotalSteps: user.recoveryTotalSteps,
      dualTrackEnabled: user.dualTrackEnabled,
      secondTrackDay: user.secondTrackDay,
    },
    ...(includeToken ? { token } : {}),
  });
});
