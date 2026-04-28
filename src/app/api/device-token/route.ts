import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { deviceTokens } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hashDeviceToken, isValidDeviceToken } from "@/lib/apns";
import { readJsonObject } from "@/lib/readJsonObject";
import { and, eq } from "drizzle-orm";

const apnsEnvironments = new Set(["development", "production"]);

export async function POST(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
    const tokenHash = hashDeviceToken(token.toLowerCase());
    const [registered] = await db
      .insert(deviceTokens)
      .values({
        userId: auth.userId,
        platform,
        token: token.toLowerCase(),
        tokenHash,
        apnsEnvironment,
        enabled: true,
        lastRegisteredAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [deviceTokens.tokenHash, deviceTokens.apnsEnvironment],
        set: {
          userId: auth.userId,
          token: token.toLowerCase(),
          enabled: true,
          lastRegisteredAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: deviceTokens.id, platform: deviceTokens.platform, apnsEnvironment: deviceTokens.apnsEnvironment });

    return NextResponse.json({ deviceToken: registered }, { status: 201 });
  } catch (error) {
    console.error("Device token registration error:", error);
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
          eq(deviceTokens.userId, auth.userId),
          eq(deviceTokens.tokenHash, hashDeviceToken(token.toLowerCase())),
          eq(deviceTokens.apnsEnvironment, apnsEnvironment),
        ),
      )
      .returning({ id: deviceTokens.id });

    return NextResponse.json({ ok: true, removed: Boolean(updated) });
  } catch (error) {
    console.error("Device token removal error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
