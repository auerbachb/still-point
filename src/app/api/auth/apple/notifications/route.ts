import { NextRequest, NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { verifyAppleJwt } from "@/lib/apple-auth";
import {
  finalizeAppleNotificationLog,
  handleAppleNotificationEvent,
  parseAppleEventsClaim,
  recordAppleNotificationReceipt,
} from "@/lib/apple-notifications";

/**
 * Sign in with Apple server-to-server notifications (#338).
 *
 * Apple POSTs `{"payload": "<JWS>"}` when a user deletes their Apple ID,
 * revokes consent, or toggles Hide My Email forwarding. The endpoint is on the
 * middleware public list — the Apple-signed JWT (verified against Apple's JWKS
 * with issuer + audience checks) is the authentication.
 */
export const POST = withApiHandler("apple notifications", async (request: NextRequest) => {
  let body: { payload?: unknown };
  try {
    body = (await request.json()) as { payload?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = typeof body?.payload === "string" ? body.payload : "";
  if (!payload) {
    return NextResponse.json({ error: "payload required" }, { status: 400 });
  }

  let claims;
  try {
    claims = await verifyAppleJwt(payload);
  } catch {
    return NextResponse.json({ error: "Invalid notification token" }, { status: 401 });
  }

  const event = parseAppleEventsClaim(claims.events);
  if (!event) {
    return NextResponse.json({ error: "Invalid events claim" }, { status: 400 });
  }

  // Receipt first: the audit row exists before any side effect runs, so a
  // mid-handling crash can never lose the record of a received notification.
  let logId: string;
  try {
    logId = await recordAppleNotificationReceipt({
      eventType: event.type,
      subject: event.sub,
      eventTime: event.event_time,
      jti: typeof claims.jti === "string" ? claims.jti : undefined,
    });
  } catch (error) {
    // Nothing has been applied yet — a redelivery starts clean.
    console.error("apple notifications: audit receipt failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    const result = await handleAppleNotificationEvent(event);
    await finalizeAppleNotificationLog(logId, result);
    return NextResponse.json({ received: true });
  } catch (error) {
    // Apple does not document retry semantics for these notifications, so the
    // 500 may be final — log loudly for manual follow-up. If Apple (or an
    // operator) redelivers, the idempotent handlers make that safe.
    console.error("apple notifications: processing failed:", error);
    await finalizeAppleNotificationLog(logId, {
      actionTaken: "processing_failed",
      userId: null,
    }).catch((finalizeError) => {
      console.error("apple notifications: failed to finalize audit row:", finalizeError);
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
});
