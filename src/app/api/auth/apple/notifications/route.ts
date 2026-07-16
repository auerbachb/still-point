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
  let receipt: Awaited<ReturnType<typeof recordAppleNotificationReceipt>>;
  try {
    receipt = await recordAppleNotificationReceipt({
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

  if (receipt.alreadySeen) {
    console.info(
      `apple notifications: duplicate jti replay suppressed (logId=${receipt.logId})`,
    );
    return NextResponse.json({ received: true });
  }

  let result: Awaited<ReturnType<typeof handleAppleNotificationEvent>>;
  try {
    result = await handleAppleNotificationEvent(event);
  } catch (error) {
    console.error("apple notifications: processing failed:", error);
    await finalizeAppleNotificationLog(receipt.logId, {
      actionTaken: "processing_failed",
      userId: null,
    }).catch((finalizeError) => {
      console.error("apple notifications: failed to finalize audit row:", finalizeError);
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  try {
    await finalizeAppleNotificationLog(receipt.logId, result);
  } catch (finalizeError) {
    console.error("apple notifications: finalize audit row failed:", finalizeError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
});
