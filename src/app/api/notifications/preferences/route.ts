import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  getDefaultPreferences,
  isValidFrequency,
  isValidTimeFormat,
  isValidTimezone,
  serializeNotificationPreferences,
  type NotificationPreferencesData,
} from "@/lib/notificationPreferences";
import { readJsonObject } from "@/lib/readJsonObject";

const RETURN_FIELDS = {
  enabled: notificationPreferences.enabled,
  dailyReminderEnabled: notificationPreferences.dailyReminderEnabled,
  preferredTime: notificationPreferences.preferredTime,
  frequency: notificationPreferences.frequency,
  quietHoursStart: notificationPreferences.quietHoursStart,
  quietHoursEnd: notificationPreferences.quietHoursEnd,
  timezone: notificationPreferences.timezone,
};

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [row] = await db
      .select(RETURN_FIELDS)
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, auth.userId))
      .limit(1);

    return NextResponse.json({
      preferences: serializeNotificationPreferences(row),
      persisted: !!row,
    });
  } catch (error) {
    console.error("Notification preferences GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await readJsonObject(request);
    if (!json.ok) return json.response;

    const body = json.body;
    const defaults = getDefaultPreferences();
    const patch: Partial<NotificationPreferencesData> = {};
    let hasUpdate = false;

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "Invalid enabled" }, { status: 400 });
      }
      patch.enabled = body.enabled;
      hasUpdate = true;
    }
    if (body.dailyReminderEnabled !== undefined) {
      if (typeof body.dailyReminderEnabled !== "boolean") {
        return NextResponse.json({ error: "Invalid dailyReminderEnabled" }, { status: 400 });
      }
      patch.dailyReminderEnabled = body.dailyReminderEnabled;
      hasUpdate = true;
    }
    if (body.preferredTime !== undefined) {
      if (typeof body.preferredTime !== "string" || !isValidTimeFormat(body.preferredTime)) {
        return NextResponse.json({ error: "Invalid preferredTime" }, { status: 400 });
      }
      patch.preferredTime = body.preferredTime;
      hasUpdate = true;
    }
    if (body.frequency !== undefined) {
      if (typeof body.frequency !== "string" || !isValidFrequency(body.frequency)) {
        return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
      }
      patch.frequency = body.frequency;
      hasUpdate = true;
    }
    if (body.quietHoursStart !== undefined) {
      const normalized = body.quietHoursStart === "" ? null : body.quietHoursStart;
      if (normalized !== null) {
        if (typeof normalized !== "string" || !isValidTimeFormat(normalized)) {
          return NextResponse.json({ error: "Invalid quietHoursStart" }, { status: 400 });
        }
      }
      patch.quietHoursStart = normalized as string | null;
      hasUpdate = true;
    }
    if (body.quietHoursEnd !== undefined) {
      const normalized = body.quietHoursEnd === "" ? null : body.quietHoursEnd;
      if (normalized !== null) {
        if (typeof normalized !== "string" || !isValidTimeFormat(normalized)) {
          return NextResponse.json({ error: "Invalid quietHoursEnd" }, { status: 400 });
        }
      }
      patch.quietHoursEnd = normalized as string | null;
      hasUpdate = true;
    }
    if (body.timezone !== undefined) {
      if (typeof body.timezone !== "string" || !isValidTimezone(body.timezone)) {
        return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
      }
      patch.timezone = body.timezone;
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return NextResponse.json({ error: "No supported preference fields provided" }, { status: 400 });
    }

    const now = new Date();
    const merged: NotificationPreferencesData = { ...defaults, ...patch };

    const [saved] = await db
      .insert(notificationPreferences)
      .values({
        userId: auth.userId,
        enabled: merged.enabled,
        dailyReminderEnabled: merged.dailyReminderEnabled,
        preferredTime: merged.preferredTime,
        frequency: merged.frequency,
        quietHoursStart: merged.quietHoursStart,
        quietHoursEnd: merged.quietHoursEnd,
        timezone: merged.timezone,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: {
          ...patch,
          updatedAt: now,
        },
      })
      .returning(RETURN_FIELDS);

    return NextResponse.json({
      preferences: serializeNotificationPreferences(saved),
      persisted: true,
    });
  } catch (error) {
    console.error("Notification preferences PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
