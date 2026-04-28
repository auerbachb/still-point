import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadGoogleCalendarStatus } from "@/lib/google";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ google: await loadGoogleCalendarStatus(auth.userId) });
  } catch (error) {
    console.error("Google status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
