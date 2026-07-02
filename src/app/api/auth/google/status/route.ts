import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { loadGoogleCalendarStatus } from "@/lib/googleOAuth";

export const GET = withApiHandler("Google status", async () => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  return NextResponse.json({ google: await loadGoogleCalendarStatus(auth.user.userId) });
});
