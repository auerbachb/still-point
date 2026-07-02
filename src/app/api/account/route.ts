import { NextResponse } from "next/server";
import { deleteUserAccount } from "@/lib/accountDeletion";
import { clearAuthCookie } from "@/lib/auth";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";

/**
 * `DELETE /api/account` — permanently delete the authenticated user's account.
 * JWT-only session: clearing the auth cookie invalidates the client (same as logout).
 */
export const DELETE = withApiHandler("Account deletion", async () => {
  const clearCookieBestEffort = async () => {
    try {
      await clearAuthCookie();
    } catch (cookieError) {
      console.error("Account deletion cookie clear failed:", cookieError);
    }
  };

  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const deleted = await deleteUserAccount(auth.user.userId);

  if (!deleted) {
    await clearCookieBestEffort();
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  await clearCookieBestEffort();
  return NextResponse.json({ ok: true });
});
