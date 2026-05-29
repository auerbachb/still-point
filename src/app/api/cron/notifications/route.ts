import { NextRequest, NextResponse } from "next/server";
import { runNotificationScheduler } from "@/lib/notificationScheduler";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice("Bearer ".length).trim();
  return token.length > 0 && token === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNotificationScheduler();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Notification cron error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
