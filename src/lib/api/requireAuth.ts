import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export type AuthUser = { userId: string; email: string };

export type RequireAuthResult =
  | { ok: true; user: AuthUser }
  | { ok: false; response: NextResponse };

/** Returns the authenticated user or a 401 JSON response. */
export async function requireAuth(): Promise<RequireAuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true, user };
}
