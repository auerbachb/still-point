import { NextRequest, NextResponse } from "next/server";
import { verifyAppleJwt } from "@/lib/apple-auth";
import {
  handleAppleNotificationEvent,
  logAppleNotification,
  parseAppleEventsClaim,
} from "@/lib/apple-notifications";

/**
 * Sign in with Apple server-to-server notifications (#338).
 *
 * Apple POSTs `{"payload": "<JWS>"}` when a user deletes their Apple ID,
 * revokes consent, or toggles Hide My Email forwarding. The endpoint is on the
 * middleware public list — the Apple-signed JWT (verified against Apple's JWKS
 * with issuer + audience checks) is the authentication.
 */
export async function POST(request: NextRequest) {
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

  try {
    const result = await handleAppleNotificationEvent(event);
    await logAppleNotification({
      eventType: event.type,
      subject: event.sub,
      eventTime: event.event_time,
      jti: typeof claims.jti === "string" ? claims.jti : undefined,
      userId: result.userId,
      actionTaken: result.actionTaken,
    });
    return NextResponse.json({ received: true });
  } catch (error) {
    // Apple does not document retry semantics for these notifications, so the
    // 500 may be final — log loudly for manual follow-up. If Apple (or an
    // operator) redelivers, the idempotent handlers make that safe.
    console.error("apple notifications: processing failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
