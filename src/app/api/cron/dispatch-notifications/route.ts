import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { dispatchDueNotifications } from "@/lib/notification-scheduler";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

export const GET = withApiHandler("dispatch-notifications cron", async (request: NextRequest) => {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchDueNotifications();
  return NextResponse.json({ ok: true, ...result });
});

export const POST = withApiHandler("dispatch-notifications cron", async (request: NextRequest) => {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchDueNotifications();
  return NextResponse.json({ ok: true, ...result });
});
