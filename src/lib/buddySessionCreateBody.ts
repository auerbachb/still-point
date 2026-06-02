import { NextRequest, NextResponse } from "next/server";

export type BuddySessionCreateBody = {
  scheduledStartAt: Date | null;
};

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseScheduledStartAt(raw: unknown): Date | null | NextResponse {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "scheduledStartAt must be an ISO timestamp" }, { status: 400 });
  }
  if (!ISO_TIMESTAMP_RE.test(raw)) {
    return NextResponse.json({ error: "scheduledStartAt must be an ISO timestamp" }, { status: 400 });
  }
  const scheduledStartAt = new Date(raw);
  if (Number.isNaN(scheduledStartAt.getTime())) {
    return NextResponse.json({ error: "scheduledStartAt must be a valid timestamp" }, { status: 400 });
  }
  if (scheduledStartAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduledStartAt must be in the future" }, { status: 400 });
  }
  return scheduledStartAt;
}

/** Parses POST /api/buddy/sessions body; rejects client-provided duration overrides (#349). */
export async function readBuddySessionCreateBody(
  request: NextRequest,
): Promise<BuddySessionCreateBody | NextResponse> {
  const text = await request.text();
  if (!text.trim()) {
    return { scheduledStartAt: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = parsed as Record<string, unknown>;

  if ("durationSeconds" in record) {
    return NextResponse.json(
      { error: "Session length is set automatically for buddy sessions" },
      { status: 400 },
    );
  }

  const scheduled = parseScheduledStartAt(record.scheduledStartAt);
  if (scheduled instanceof NextResponse) return scheduled;

  return { scheduledStartAt: scheduled };
}
