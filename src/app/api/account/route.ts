import { NextResponse } from "next/server";
import { deleteUserAccount } from "@/lib/accountDeletion";
import { clearAuthCookie, getCurrentUser } from "@/lib/auth";

/**
 * `DELETE /api/account` — permanently delete the authenticated user's account.
 * JWT-only session: clearing the auth cookie invalidates the client (same as logout).
 */
export async function DELETE() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deleted = await deleteUserAccount(auth.userId);

    await clearAuthCookie();

    if (!deleted) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Account deletion error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
