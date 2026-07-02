import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  atomicConfirmPasswordReset,
  atomicIssuePasswordResetToken,
  atomicRollbackPasswordResetToken,
} from "@/db/atomic";
import { users } from "@/db/schema";
import { withApiHandler } from "@/lib/api/withApiHandler";
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
import { eq } from "drizzle-orm";

export const POST = withApiHandler("Password reset request", async (request: NextRequest) => {
  const body = await request.json().catch(() => ({}));
  const email = normalizeResetEmail(body?.email);

  if (!email) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const hashedIp = requestIpHash(request);
  if (isPasswordResetRateLimited(email, hashedIp)) {
    return NextResponse.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
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

  const resetToken = await createPasswordResetToken({ userId: user.id });
  const recentCutoff = new Date(Date.now() - 1000 * 60 * 5);
  const tokenIssue = await atomicIssuePasswordResetToken({
    userId: user.id,
    tokenHash: hashResetToken(resetToken),
    requestIpHash: hashedIp,
    expiresAt: passwordResetExpiresAt(),
    recentCutoff,
    plainToken: resetToken,
  });

  if (tokenIssue) {
    try {
      await sendPasswordResetEmail({ to: user.email, token: tokenIssue.token });
    } catch (error) {
      try {
        await atomicRollbackPasswordResetToken({
          userId: user.id,
          newTokenId: tokenIssue.newTokenId,
          previousTokenId: tokenIssue.previousTokenId,
        });
      } catch (rollbackError) {
        console.error("Password reset rollback error:", rollbackError);
      }
      console.error("Password reset email delivery error:", error);
    }
  }

  return NextResponse.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
});
