import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationPreferences } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  serializePreferences,
  validatePreferencesPatch,
} from "@/lib/notifications/preferences";
import type { NotificationPreferencesRow } from "@/lib/notifications/types";

async function getOrCreatePreferences(userId: string): Promise<NotificationPreferencesRow> {
  const existing = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId))
    .limit(1);

  if (existing[0]) {
    return existing[0] as NotificationPreferencesRow;
  }

  const [created] = await db
    .insert(notificationPreferences)
    .values({ userId, ...DEFAULT_NOTIFICATION_PREFERENCES })
    .returning();

  return created as NotificationPreferencesRow;
}

export async function GET() {
  try {
    const auth = await getCurrentUser();
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prefs = await getOrCreatePreferences(auth.userId);
    return NextResponse.json({ preferences: serializePreferences(prefs) });
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

    const body = await request.json();
    const validated = validatePreferencesPatch(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    await getOrCreatePreferences(auth.userId);

    const [updated] = await db
      .update(notificationPreferences)
      .set({ ...validated.patch, updatedAt: new Date() })
      .where(eq(notificationPreferences.userId, auth.userId))
      .returning();

    return NextResponse.json({ preferences: serializePreferences(updated as NotificationPreferencesRow) });
  } catch (error) {
    console.error("Notification preferences PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
