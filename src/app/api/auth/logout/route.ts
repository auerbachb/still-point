import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";
import { clearAuthJsCookies } from "@/lib/authJsCookies";

export async function POST() {
  await clearAuthCookie();
  // Belt-and-suspenders: clear any lingering Auth.js cookies (#136). Most
  // OAuth users only carry sp_token because oauth-complete drops the
  // Auth.js cookies on hand-off, but if the user never made it through
  // oauth-complete the session cookie can still be present here.
  await clearAuthJsCookies();
  return NextResponse.json({ ok: true });
}
