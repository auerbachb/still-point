import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { requireAuth } from "@/lib/api/requireAuth";
import { withApiHandler } from "@/lib/api/withApiHandler";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  getOrCreateNotificationPreferences,
  isValidFrequency,
  isValidReminderTime,
  isValidTimezone,
  isValidE164PhoneNumber,
  isValidCallWindow,
  callOptInRequirementsMet,
  asNotificationPreferencesRow,
  serializeNotificationPreferences,
} from "@/lib/notification-preferences";
import { readJsonObject } from "@/lib/readJsonObject";
import { eq } from "drizzle-orm";

export const GET = withApiHandler("Notification preferences GET", async () => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const prefs = await getOrCreateNotificationPreferences(auth.user.userId);
  return NextResponse.json({ preferences: serializeNotificationPreferences(prefs) });
});

export const PATCH = withApiHandler("Notification preferences PATCH", async (request: NextRequest) => {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

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
  if (typeof body.failureReasonReminderEnabled === "boolean") {
    updates.failureReasonReminderEnabled = body.failureReasonReminderEnabled;
    hasUpdate = true;
  }
  if (typeof body.friendRequestNotificationsEnabled === "boolean") {
    updates.friendRequestNotificationsEnabled = body.friendRequestNotificationsEnabled;
    hasUpdate = true;
  }
  if (typeof body.suppressDuringSession === "boolean") {
    updates.suppressDuringSession = body.suppressDuringSession;
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

  if (typeof body.callOptIn === "boolean") {
    updates.callOptIn = body.callOptIn;
    hasUpdate = true;
  }
  if (body.callPhoneNumber === null) {
    updates.callPhoneNumber = null;
    hasUpdate = true;
  } else if (typeof body.callPhoneNumber === "string") {
    if (!isValidE164PhoneNumber(body.callPhoneNumber)) {
      return NextResponse.json({ error: "callPhoneNumber must be E.164 format, e.g. +15551234567" }, { status: 400 });
    }
    updates.callPhoneNumber = body.callPhoneNumber;
    hasUpdate = true;
  }
  if (body.callWindowStart === null) {
    updates.callWindowStart = null;
    hasUpdate = true;
  } else if (typeof body.callWindowStart === "string") {
    if (!isValidReminderTime(body.callWindowStart)) {
      return NextResponse.json({ error: "callWindowStart must be HH:MM (24h)" }, { status: 400 });
    }
    updates.callWindowStart = body.callWindowStart;
    hasUpdate = true;
  }
  if (body.callWindowStop === null) {
    updates.callWindowStop = null;
    hasUpdate = true;
  } else if (typeof body.callWindowStop === "string") {
    if (!isValidReminderTime(body.callWindowStop)) {
      return NextResponse.json({ error: "callWindowStop must be HH:MM (24h)" }, { status: 400 });
    }
    updates.callWindowStop = body.callWindowStop;
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

  const callStartTouched = Object.prototype.hasOwnProperty.call(updates, "callWindowStart");
  const callStopTouched = Object.prototype.hasOwnProperty.call(updates, "callWindowStop");
  if (callStartTouched !== callStopTouched) {
    return NextResponse.json(
      { error: "callWindowStart and callWindowStop must be updated together" },
      { status: 400 },
    );
  }

  const existing = await getOrCreateNotificationPreferences(auth.user.userId);
  const mergedCallFields = {
    callPhoneNumber: (updates.callPhoneNumber as string | null | undefined) ?? existing.callPhoneNumber,
    callWindowStart: (updates.callWindowStart as string | null | undefined) ?? existing.callWindowStart,
    callWindowStop: (updates.callWindowStop as string | null | undefined) ?? existing.callWindowStop,
  };
  const nextCallOptIn = typeof updates.callOptIn === "boolean" ? updates.callOptIn : existing.callOptIn;

  if (callStartTouched && callStopTouched) {
    const start = updates.callWindowStart as string | null;
    const stop = updates.callWindowStop as string | null;
    if (start !== null && stop !== null && !isValidCallWindow(start, stop)) {
      return NextResponse.json(
        { error: "callWindowStart and callWindowStop must differ and be valid HH:MM times" },
        { status: 400 },
      );
    }
  }

  if (nextCallOptIn) {
    if (!callOptInRequirementsMet(mergedCallFields)) {
      return NextResponse.json(
        { error: "callOptIn requires callPhoneNumber plus callWindowStart and callWindowStop" },
        { status: 400 },
      );
    }
    if (!existing.callOptIn) {
      updates.callConsentAt = new Date();
    }
  } else if (existing.callOptIn || updates.callOptIn === false) {
    updates.callConsentAt = null;
  }

  const [updated] = await db
    .update(notificationPreferences)
    .set(updates)
    .where(eq(notificationPreferences.userId, auth.user.userId))
    .returning();

  if (!updated) {
    const now = new Date();
    const [inserted] = await db
      .insert(notificationPreferences)
      .values({
        userId: auth.user.userId,
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
});
