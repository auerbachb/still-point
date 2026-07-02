import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { passwordResetTokens, users } from "@/db/schema";
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
import { and, eq, gt, isNull, sql } from "drizzle-orm";

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

  const tokenIssue = await poolDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`password-reset:${user.id}`}))`);

    const recentCutoff = new Date(Date.now() - 1000 * 60 * 5);
    const [activeToken] = await tx
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
      return null;
    }

    const [previousToken] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });

    const resetToken = await createPasswordResetToken({ userId: user.id });
    const [newToken] = await tx
      .insert(passwordResetTokens)
      .values({
        userId: user.id,
        tokenHash: hashResetToken(resetToken),
        requestIpHash: hashedIp,
        expiresAt: passwordResetExpiresAt(),
      })
      .returning({ id: passwordResetTokens.id });
    return { token: resetToken, newTokenId: newToken.id, previousTokenId: previousToken?.id ?? null };
  });
  if (tokenIssue) {
    try {
      await sendPasswordResetEmail({ to: user.email, token: tokenIssue.token });
    } catch (error) {
      await poolDb.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`password-reset:${user.id}`}))`);
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(eq(passwordResetTokens.id, tokenIssue.newTokenId));
        if (tokenIssue.previousTokenId) {
          await tx
            .update(passwordResetTokens)
            .set({ usedAt: null })
            .where(eq(passwordResetTokens.id, tokenIssue.previousTokenId));
        }
      });
      console.error("Password reset email delivery error:", error);
    }
  }

  return NextResponse.json({ message: PASSWORD_RESET_REQUEST_MESSAGE });
});
