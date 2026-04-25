import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { poolDb } from "@/db/pool";
import { passwordResetTokens, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { getPasswordResetPayload } from "@/lib/passwordReset";

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

    const resetPayload = await getPasswordResetPayload(token);
    if (!resetPayload) {
      return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const updated = await poolDb.transaction(async (tx) => {
      const [resetToken] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, resetPayload.userId),
            eq(passwordResetTokens.tokenHash, resetPayload.tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, new Date()),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });
      if (!resetToken) {
        return false;
      }
      await tx.update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, resetToken.userId));
      return true;
    });
    if (!updated) {
      return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Password reset confirm error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
