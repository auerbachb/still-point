import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webPushSubscriptions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/readJsonObject";
import {
  getWebPushPublicKey,
  hashWebPushEndpoint,
  isValidPushSubscriptionInput,
} from "@/lib/web-push";

export async function GET() {
  const publicKey = getWebPushPublicKey();
  if (!publicKey) {
    return NextResponse.json({ error: "Web Push is not configured" }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!getWebPushPublicKey()) {
      return NextResponse.json({ error: "Web Push is not configured" }, { status: 503 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) {
      return json.response;
    }

    const subscription = json.body.subscription;
    if (!isValidPushSubscriptionInput(subscription)) {
      return NextResponse.json(
        { error: "subscription must include endpoint and keys.p256dh / keys.auth" },
        { status: 400 },
      );
    }

    const userAgent = request.headers.get("user-agent")?.slice(0, 512) ?? null;
    const endpointHash = hashWebPushEndpoint(subscription.endpoint);
    const now = new Date();

    const [registered] = await db
      .insert(webPushSubscriptions)
      .values({
        userId: auth.userId,
        endpoint: subscription.endpoint,
        endpointHash,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
        enabled: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: webPushSubscriptions.endpointHash,
        set: {
          userId: auth.userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userAgent,
          enabled: true,
          updatedAt: now,
        },
      })
      .returning({ id: webPushSubscriptions.id });

    return NextResponse.json({ subscription: { id: registered.id } }, { status: 201 });
  } catch (error) {
    console.error("Web Push subscription registration error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) {
      return json.response;
    }

    const endpoint = json.body.endpoint;
    if (typeof endpoint !== "string" || endpoint.length < 8) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }

    const [updated] = await db
      .update(webPushSubscriptions)
      .set({ enabled: false, updatedAt: new Date() })
      .where(
        and(
          eq(webPushSubscriptions.userId, auth.userId),
          eq(webPushSubscriptions.endpointHash, hashWebPushEndpoint(endpoint)),
        ),
      )
      .returning({ id: webPushSubscriptions.id });

    return NextResponse.json({ ok: true, removed: Boolean(updated) });
  } catch (error) {
    console.error("Web Push subscription removal error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
