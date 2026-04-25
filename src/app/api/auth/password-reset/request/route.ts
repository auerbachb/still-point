import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { passwordResetTokens, users } from "@/db/schema";
import { sendPasswordResetEmail } from "@/lib/email";
import {
  PASSWORD_RESET_REQUEST_MESSAGE,
  createPasswordResetToken,
  hashResetToken,
  isPasswordResetRateLimited,
  normalizeResetEmail,
  passwordResetExpiresAt,
  recordPasswordResetAttempt,
  requestIpHash,
} from "@/lib/passwordReset";
import { and, eq, gt, isNull } from "drizzle-orm";

const RATE_LIMITED_STATUS = 202;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeResetEmail(body?.email);

    if (!email) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }

    const hashedIp = requestIpHash(request);
    if (isPasswordResetRateLimited(email, hashedIp)) {
      return NextResponse.json(
        {
          message: PASSWORD_RESET_REQUEST_MESSAGE,
          throttled: true,
        },
        { status: RATE_LIMITED_STATUS },
      );
    }
    recordPasswordResetAttempt(email, hashedIp);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      return NextResponse.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
    }

    const recentCutoff = new Date(Date.now() - 1000 * 60 * 5);
    const [activeToken] = await db
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.createdAt, recentCutoff),
        ),
      )
      .limit(1);

    if (activeToken) {
      return NextResponse.json(
        {
          message: PASSWORD_RESET_REQUEST_MESSAGE,
          throttled: true,
        },
        { status: RATE_LIMITED_STATUS },
      );
    }

    const token = await createPasswordResetToken({ userId: user.id, email: user.email });
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashResetToken(token),
      requestIpHash: hashedIp,
      expiresAt: passwordResetExpiresAt(),
    });
    await sendPasswordResetEmail({ to: user.email, token });

    return NextResponse.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
  } catch (error) {
    console.error("Password reset request error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
