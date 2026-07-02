import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, createToken, setAuthCookie } from "@/lib/auth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { uniqueViolationConstraint } from "@/lib/dbErrors";
import { readJsonObject } from "@/lib/readJsonObject";
import { USERNAME_ERROR, isValidUsername } from "@/lib/username";
import { eq, sql } from "drizzle-orm";

export const POST = withApiHandler("Signup", async (request: NextRequest) => {
  const includeToken = request.headers.get("x-still-point-client") === "ios";
  const json = await readJsonObject(request);
  if (!json.ok) return json.response;

  const email = json.body.email;
  const username = json.body.username;
  const password = json.body.password;

  if (
    typeof email !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string" ||
    !email ||
    !username ||
    !password
  ) {
    return NextResponse.json({ error: "All fields required" }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  if (!isValidUsername(username)) {
    return NextResponse.json({ error: USERNAME_ERROR }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase();

  const existingEmail = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
  if (existingEmail.length > 0) {
    return NextResponse.json({ error: "Email already in use" }, { status: 409 });
  }

  const existingUsername = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  if (existingUsername.length > 0) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  let newUser;
  try {
    [newUser] = await db.insert(users).values({
      email: normalizedEmail,
      username,
      passwordHash,
    }).returning();
  } catch (err) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint !== null) {
      if (constraint.includes("email")) {
        return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      }
      if (constraint.includes("username")) {
        return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      }
      return NextResponse.json({ error: "Email or username already in use" }, { status: 409 });
    }
    throw err;
  }

  const token = await createToken({ userId: newUser.id, email: newUser.email });
  await setAuthCookie(token);

  return NextResponse.json({
    user: {
      id: newUser.id,
      email: newUser.email,
      username: newUser.username,
      isPublic: newUser.isPublic,
      currentDay: newUser.currentDay,
      aphorismsEnabled: newUser.aphorismsEnabled,
      attentionTrackingEnabled: newUser.attentionTrackingEnabled,
      recoveryTargetDay: newUser.recoveryTargetDay,
      recoveryCurrentStep: newUser.recoveryCurrentStep,
      recoveryTotalSteps: newUser.recoveryTotalSteps,
      dualTrackEnabled: newUser.dualTrackEnabled,
      secondTrackDay: newUser.secondTrackDay,
    },
    ...(includeToken ? { token } : {}),
  });
});
