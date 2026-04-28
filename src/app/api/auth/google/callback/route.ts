import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  exchangeGoogleCodeForTokens,
  getGoogleStateCookieName,
  verifyGoogleOAuthState,
} from "@/lib/google";

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, "") ?? "https://still-point.me";
  const redirectAndClearState = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.cookies.delete(getGoogleStateCookieName());
    return response;
  };
  try {
    const auth = await getCurrentUser();
    const doneUrl = new URL("/app", appUrl);

    if (!auth) {
      doneUrl.searchParams.set("googleCalendar", "unauthorized");
      return redirectAndClearState(doneUrl);
    }

    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    const error = request.nextUrl.searchParams.get("error");
    const nonceCookie = request.cookies.get(getGoogleStateCookieName())?.value;

    if (error) {
      doneUrl.searchParams.set("googleCalendar", "denied");
      return redirectAndClearState(doneUrl);
    }
    if (!code || !verifyGoogleOAuthState(state, nonceCookie, auth.userId)) {
      doneUrl.searchParams.set("googleCalendar", "invalid");
      return redirectAndClearState(doneUrl);
    }

    await exchangeGoogleCodeForTokens(code, auth.userId);
    doneUrl.searchParams.set("googleCalendar", "connected");
    return redirectAndClearState(doneUrl);
  } catch (error) {
    console.error("Google OAuth callback error:", error);
    const failedUrl = new URL("/app", appUrl);
    failedUrl.searchParams.set("googleCalendar", "failed");
    return redirectAndClearState(failedUrl);
  }
}
