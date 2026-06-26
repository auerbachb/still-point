import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { failureReasons } from "@/db/schema";
import type { ApnsPayload } from "@/lib/apns";

export const FAILURE_REASON_NOTIFICATION_TYPE = "failure_reason_reminder";

/** Fixed 8 PM local trigger for the failure-reason reminder, as minutes since midnight. */
export const FAILURE_REASON_REMINDER_MINUTES = 20 * 60;

export type FailureReasonReminderWebPushPayload = {
  title: string;
  body: string;
  type: typeof FAILURE_REASON_NOTIFICATION_TYPE;
  url: string;
};

function deepLinkForDate(targetDate: string): string {
  return `stillpoint://log-reason?date=${targetDate}`;
}

function webUrlForDate(targetDate: string): string {
  return `/app/log-reason?date=${targetDate}`;
}

function copyForTarget(isYesterday: boolean): { title: string; body: string } {
  return isYesterday
    ? {
      title: "Still Point",
      body: "You didn't meditate yesterday. Take a moment to log why.",
    }
    : {
      title: "Still Point",
      body: "Still time to meditate! Log why you can't, or start a quick session.",
    };
}

export function buildFailureReasonReminderPayload(
  targetDate: string,
  isYesterday: boolean,
): ApnsPayload {
  const { title, body } = copyForTarget(isYesterday);
  return {
    aps: {
      alert: { title, body },
      sound: "default",
      "thread-id": "meditation-reminders",
    },
    type: FAILURE_REASON_NOTIFICATION_TYPE,
    deepLink: deepLinkForDate(targetDate),
  };
}

export function buildFailureReasonReminderWebPushPayload(
  targetDate: string,
  isYesterday: boolean,
): FailureReasonReminderWebPushPayload {
  const { title, body } = copyForTarget(isYesterday);
  return {
    title,
    body,
    type: FAILURE_REASON_NOTIFICATION_TYPE,
    url: webUrlForDate(targetDate),
  };
}

/** Whether the user has already logged a failure reason for the given local date. */
export async function hasFailureReasonForDate(
  userId: string,
  date: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: failureReasons.id })
    .from(failureReasons)
    .where(
      and(
        eq(failureReasons.userId, userId),
        eq(failureReasons.reasonDate, date),
      ),
    )
    .limit(1);

  return !!row;
}
