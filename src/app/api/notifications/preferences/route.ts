import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getOrCreateNotificationPreferences,
  isValidFrequency,
  isValidReminderTime,
  isValidTimezone,
  asNotificationPreferencesRow,
  serializeNotificationPreferences,
} from "@/lib/notification-preferences";
import { readJsonObject } from "@/lib/readJsonObject";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prefs = await getOrCreateNotificationPreferences(auth.userId);
    return NextResponse.json({ preferences: serializeNotificationPreferences(prefs) });
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
    if (!json.ok) {
      return json.response;
    }

    const body = json.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    let hasUpdate = false;

    if (typeof body.pushEnabled === "boolean") {
      updates.pushEnabled = body.pushEnabled;
      hasUpdate = true;
    }
    if (typeof body.dailyReminderEnabled === "boolean") {
      updates.dailyReminderEnabled = body.dailyReminderEnabled;
      hasUpdate = true;
    }
    if (typeof body.missADayEnabled === "boolean") {
      updates.missADayEnabled = body.missADayEnabled;
      hasUpdate = true;
    }
    if (typeof body.friendRequestNotificationsEnabled === "boolean") {
      updates.friendRequestNotificationsEnabled = body.friendRequestNotificationsEnabled;
      hasUpdate = true;
    }
    if (typeof body.dailyReminderTime === "string") {
      if (!isValidReminderTime(body.dailyReminderTime)) {
        return NextResponse.json({ error: "dailyReminderTime must be HH:MM (24h)" }, { status: 400 });
      }
      updates.dailyReminderTime = body.dailyReminderTime;
      hasUpdate = true;
    }
    if (typeof body.dailyReminderFrequency === "string") {
      if (!isValidFrequency(body.dailyReminderFrequency)) {
        return NextResponse.json(
          { error: "dailyReminderFrequency must be daily, every_other, or weekly" },
          { status: 400 },
        );
      }
      updates.dailyReminderFrequency = body.dailyReminderFrequency;
      hasUpdate = true;
    }
    if (body.quietHoursStart === null) {
      updates.quietHoursStart = null;
      hasUpdate = true;
    } else if (typeof body.quietHoursStart === "string") {
      if (!isValidReminderTime(body.quietHoursStart)) {
        return NextResponse.json({ error: "quietHoursStart must be HH:MM (24h)" }, { status: 400 });
      }
      updates.quietHoursStart = body.quietHoursStart;
      hasUpdate = true;
    }
    if (body.quietHoursEnd === null) {
      updates.quietHoursEnd = null;
      hasUpdate = true;
    } else if (typeof body.quietHoursEnd === "string") {
      if (!isValidReminderTime(body.quietHoursEnd)) {
        return NextResponse.json({ error: "quietHoursEnd must be HH:MM (24h)" }, { status: 400 });
      }
      updates.quietHoursEnd = body.quietHoursEnd;
      hasUpdate = true;
    }
    if (typeof body.tz === "string") {
      if (!isValidTimezone(body.tz)) {
        return NextResponse.json({ error: "tz must be a valid IANA timezone" }, { status: 400 });
      }
      updates.tz = body.tz;
      hasUpdate = true;
    }

    if (!hasUpdate) {
      return NextResponse.json({ error: "No supported preference fields provided" }, { status: 400 });
    }

    const quietStartTouched = Object.prototype.hasOwnProperty.call(updates, "quietHoursStart");
    const quietEndTouched = Object.prototype.hasOwnProperty.call(updates, "quietHoursEnd");
    if (quietStartTouched !== quietEndTouched) {
      return NextResponse.json(
        { error: "quietHoursStart and quietHoursEnd must be updated together" },
        { status: 400 },
      );
    }

    await getOrCreateNotificationPreferences(auth.userId);

    const [updated] = await db
      .update(notificationPreferences)
      .set(updates)
      .where(eq(notificationPreferences.userId, auth.userId))
      .returning();

    if (!updated) {
      const now = new Date();
      const [inserted] = await db
        .insert(notificationPreferences)
        .values({
          userId: auth.userId,
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...updates,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return NextResponse.json({
        preferences: serializeNotificationPreferences(asNotificationPreferencesRow(inserted)),
      });
    }

    return NextResponse.json({
      preferences: serializeNotificationPreferences(asNotificationPreferencesRow(updated)),
    });
  } catch (error) {
    console.error("Notification preferences PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
