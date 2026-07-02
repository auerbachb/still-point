import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import {
  GoogleCalendarUnavailableError,
  buildGoogleAuthUrl,
  makeGoogleOAuthState,
} from "@/lib/googleOAuth";

export const GET = withApiHandler(
  "Google OAuth start",
  async () => {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const oauthState = makeGoogleOAuthState(auth.user.userId);
    const response = NextResponse.redirect(buildGoogleAuthUrl(oauthState.state));
    response.cookies.set(oauthState.cookie);
    return response;
  },
  {
    mapError: (error) => {
      if (error instanceof GoogleCalendarUnavailableError) {
        return NextResponse.json({ error: error.message }, { status: 503 });
      }
      return null;
    },
  },
);
