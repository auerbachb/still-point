import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deviceTokens } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import { hashDeviceToken, isValidDeviceToken } from "@/lib/apns";
import { readJsonObject } from "@/lib/readJsonObject";
import { and, eq } from "drizzle-orm";

const apnsEnvironments = new Set(["development", "production"]);

export const POST = withApiHandler("Device token registration", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const json = await readJsonObject(request);
  if (!json.ok) {
    return json.response;
  }

  const token = json.body.token;
  if (typeof token !== "string" || !isValidDeviceToken(token)) {
    return NextResponse.json({ error: "token must be a valid APNs device token" }, { status: 400 });
  }

  const platform = json.body.platform ?? "ios";
  if (platform !== "ios") {
    return NextResponse.json({ error: "platform must be \"ios\"" }, { status: 400 });
  }

  const apnsEnvironment = json.body.apnsEnvironment;
  if (typeof apnsEnvironment !== "string" || !apnsEnvironments.has(apnsEnvironment)) {
    return NextResponse.json(
      { error: "apnsEnvironment must be \"development\" or \"production\"" },
      { status: 400 },
    );
  }

  const now = new Date();
  const normalizedToken = token.trim().toLowerCase();
  const tokenHash = hashDeviceToken(normalizedToken);
  const [registered] = await db
    .insert(deviceTokens)
    .values({
      userId: auth.user.userId,
      platform,
      token: normalizedToken,
      tokenHash,
      apnsEnvironment,
      enabled: true,
      lastRegisteredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [deviceTokens.tokenHash, deviceTokens.apnsEnvironment],
      set: {
        userId: auth.user.userId,
        token: normalizedToken,
        enabled: true,
        lastRegisteredAt: now,
        updatedAt: now,
      },
    })
    .returning({ id: deviceTokens.id, platform: deviceTokens.platform, apnsEnvironment: deviceTokens.apnsEnvironment });

  return NextResponse.json({ deviceToken: registered }, { status: 201 });
});

export const DELETE = withApiHandler("Device token removal", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const json = await readJsonObject(request);
  if (!json.ok) {
    return json.response;
  }

  const token = json.body.token;
  if (typeof token !== "string" || !isValidDeviceToken(token)) {
    return NextResponse.json({ error: "token must be a valid APNs device token" }, { status: 400 });
  }

  const apnsEnvironment = json.body.apnsEnvironment;
  if (typeof apnsEnvironment !== "string" || !apnsEnvironments.has(apnsEnvironment)) {
    return NextResponse.json(
      { error: "apnsEnvironment must be \"development\" or \"production\"" },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(deviceTokens)
    .set({ enabled: false, updatedAt: new Date() })
    .where(
      and(
        eq(deviceTokens.userId, auth.user.userId),
        eq(deviceTokens.tokenHash, hashDeviceToken(token)),
        eq(deviceTokens.apnsEnvironment, apnsEnvironment),
      ),
    )
    .returning({ id: deviceTokens.id });

  return NextResponse.json({ ok: true, removed: Boolean(updated) });
});
