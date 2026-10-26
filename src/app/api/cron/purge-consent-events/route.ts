import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/api/cronAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { purgeExpiredConsentEvents } from "@/lib/consent-retention";

async function runPurge(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cutoff, deletedEvents, purgedGroups } = await purgeExpiredConsentEvents();

  return NextResponse.json({
    ok: true,
    cutoff: cutoff.toISOString(),
    deletedEvents,
    purgedGroups,
  });
}

export const GET = withApiHandler("purge-consent-events cron", runPurge);

export const POST = withApiHandler("purge-consent-events cron", runPurge);
