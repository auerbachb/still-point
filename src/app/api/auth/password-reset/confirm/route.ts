import { NextRequest, NextResponse } from "next/server";
import { atomicConfirmPasswordReset } from "@/db/atomic";
import { hashPassword } from "@/lib/auth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { getPasswordResetPayload } from "@/lib/passwordReset";

export const POST = withApiHandler("Password reset confirm", async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Valid token and password of at least 8 characters required" },
      { status: 400 },
    );
  }
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
  const updated = await atomicConfirmPasswordReset({
    userId: resetPayload.userId,
    tokenHash: resetPayload.tokenHash,
    passwordHash,
    now: new Date(),
  });
  if (!updated) {
    return NextResponse.json({ error: "Reset link is invalid or expired" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
});
