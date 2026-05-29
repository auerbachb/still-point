import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions } from "@/db/schema";

/** True when the user has any completed session on the given local calendar date. */
export async function userCompletedSessionOnDate(params: {
  userId: string;
  localDate: string;
}): Promise<boolean> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, params.userId),
        eq(sessions.sessionDate, params.localDate),
        eq(sessions.completed, true),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Count consecutive calendar days with a completed standard session ending at `endDate`. */
export async function userStandardStreakEndingOnDate(params: {
  userId: string;
  endDate: string;
  maxLookbackDays?: number;
}): Promise<number> {
  const lookback = params.maxLookbackDays ?? 120;
  const startDate = subtractCalendarDays(params.endDate, lookback);
  const rows = await db
    .select({
      sessionDate: sessions.sessionDate,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, params.userId),
        eq(sessions.sessionType, "standard"),
        eq(sessions.completed, true),
        sql`${sessions.sessionDate} >= ${startDate}`,
        sql`${sessions.sessionDate} <= ${params.endDate}`,
      ),
    );

  const completedDates = new Set(rows.map((r) => r.sessionDate));
  let streak = 0;
  let cursor = params.endDate;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = subtractCalendarDays(cursor, 1);
  }
  return streak;
}

function subtractCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day - days));
  return utc.toISOString().slice(0, 10);
}
