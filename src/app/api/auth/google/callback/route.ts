import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  exchangeGoogleCodeForTokens,
  getGoogleStateCookieName,
  verifyGoogleOAuthState,
} from "@/lib/google";

export async function GET(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, "") ?? request.nextUrl.origin;
    const doneUrl = new URL("/app", appUrl);

    if (!auth) {
      doneUrl.searchParams.set("googleCalendar", "unauthorized");
      return NextResponse.redirect(doneUrl);
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");
    const nonceCookie = request.cookies.get(getGoogleStateCookieName())?.value;

    if (error) {
      doneUrl.searchParams.set("googleCalendar", "denied");
      return NextResponse.redirect(doneUrl);
    }
    if (!code || !verifyGoogleOAuthState(state, nonceCookie, auth.userId)) {
      doneUrl.searchParams.set("googleCalendar", "invalid");
      return NextResponse.redirect(doneUrl);
    }

    await exchangeGoogleCodeForTokens(code, auth.userId);
    doneUrl.searchParams.set("googleCalendar", "connected");
    const response = NextResponse.redirect(doneUrl);
    response.cookies.delete(getGoogleStateCookieName());
    return response;
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, "") ?? request.nextUrl.origin;
    const failedUrl = new URL("/app", appUrl);
    failedUrl.searchParams.set("googleCalendar", "failed");
    return NextResponse.redirect(failedUrl);
  }
}
