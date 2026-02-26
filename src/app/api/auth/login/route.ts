import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, createToken, setAuthCookie } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { email, username, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Update username if changed
    if (username && username !== user.username) {
      const existingUsername = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (existingUsername.length === 0) {
        await db.update(users).set({ username, updatedAt: new Date() }).where(eq(users.id, user.id));
        user.username = username;
      }
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
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
