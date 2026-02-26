import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, createToken, setAuthCookie } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { email, username, password } = await request.json();

    if (!email || !username || !password) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    if (username.length < 3 || username.length > 30 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json({ error: "Username must be 3-30 characters (letters, numbers, underscores)" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const existingEmail = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existingEmail.length > 0) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const existingUsername = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existingUsername.length > 0) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const [newUser] = await db.insert(users).values({
      email: email.toLowerCase(),
      username,
      passwordHash,
    }).returning();

    const token = await createToken({ userId: newUser.id, email: newUser.email });
    await setAuthCookie(token);

    return NextResponse.json({
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        isPublic: newUser.isPublic,
        currentDay: newUser.currentDay,
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
