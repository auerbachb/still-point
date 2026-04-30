import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";
import { clearAuthJsCookies } from "@/lib/authJsCookies";

export async function POST() {
  await clearAuthCookie();
  // Belt-and-suspenders: clear any lingering Auth.js cookies (#136). Most
  // OAuth users only carry sp_token because oauth-complete drops the
  // Auth.js cookies on hand-off, but if the user never made it through
  // oauth-complete the session cookie can still be present here. This is
  // best-effort cleanup — a throw here should not turn a successful sp_token
  // clear into a 500 to the client.
  try {
    await clearAuthJsCookies();
  } catch (err) {
    console.error("logout cookie cleanup failed:", err);
  }
  return NextResponse.json({ ok: true });
}
