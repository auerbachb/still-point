import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { getApnsConfigStatus } from "@/lib/apns";
import { dispatchDueNotifications } from "@/lib/notification-scheduler";

function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

async function runDispatch(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchDueNotifications();

  // Surface a misconfigured APNs environment in the cron's own output rather than
  // burying it behind a 200 the way swallowed per-token send failures were (#621):
  // this ran for weeks emitting sent:0 while APNS_BUNDLE_ID was simply unset.
  const { configured: apnsConfigured, missing: apnsMissing } = getApnsConfigStatus();
  if (!apnsConfigured) {
    console.error("dispatch-notifications: APNs is not configured", { missing: apnsMissing });
  }

  return NextResponse.json({
    ok: true,
    apnsConfigured,
    ...(apnsConfigured ? {} : { apnsMissing }),
    ...result,
  });
}

export const GET = withApiHandler("dispatch-notifications cron", runDispatch);

export const POST = withApiHandler("dispatch-notifications cron", runDispatch);
