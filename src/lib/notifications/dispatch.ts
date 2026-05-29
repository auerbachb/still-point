import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notificationDispatches } from "@/db/schema";
import type { ScheduledNotificationType } from "@/lib/notifications/types";

export async function hasDispatchedToday(params: {
  userId: string;
  localDate: string;
}): Promise<boolean> {
  const rows = await db
    .select({ id: notificationDispatches.id })
    .from(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.userId, params.userId),
        eq(notificationDispatches.localDate, params.localDate),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

export async function recordDispatch(params: {
  userId: string;
  localDate: string;
  notificationType: ScheduledNotificationType;
}): Promise<boolean> {
  try {
    await db.insert(notificationDispatches).values({
      userId: params.userId,
      localDate: params.localDate,
      notificationType: params.notificationType,
    });
    return true;
  } catch (error) {
    // Unique (user_id, local_date) — another worker won the race.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: unknown }).code === "23505"
    ) {
      return false;
    }
    throw error;
  }
}
