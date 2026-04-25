import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { confirmPasswordResetToken } from "@/lib/passwordReset";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!token || password.length < 8) {
      return NextResponse.json(
        { error: "Valid token and password of at least 8 characters required" },
        { status: 400 },
      );
    }

    const confirmed = await confirmPasswordResetToken(token);
    if (!confirmed.ok) {
      return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    await db.update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, confirmed.userId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Password reset confirm error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
