import { NextRequest, NextResponse } from "next/server";
import { runNotificationScheduler } from "@/lib/notifications/scheduler";

function authorizeCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runNotificationScheduler();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Notification cron error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
