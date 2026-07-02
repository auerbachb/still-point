import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  GoogleCalendarUnavailableError,
  buildGoogleAuthUrl,
  makeGoogleOAuthState,
} from "@/lib/googleOAuth";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const oauthState = makeGoogleOAuthState(auth.userId);
    const response = NextResponse.redirect(buildGoogleAuthUrl(oauthState.state));
    response.cookies.set(oauthState.cookie);
    return response;
  } catch (error) {
    if (error instanceof GoogleCalendarUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("Google OAuth start error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
