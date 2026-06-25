import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceTokens } from "@/db/schema";
import { type ApnsEnvironment, type ApnsPayload, sendApnsNotification } from "@/lib/apns";
import {
  buildDailyReminderPayload,
  buildDailyReminderWebPushPayload,
  MISS_A_DAY_NOTIFICATION_TYPE,
} from "@/lib/notifications/daily-reminder";
import { sendWebPushToUser } from "@/lib/web-push";

const invalidTokenReasons = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);
const PUSH_SEND_CONCURRENCY = 3;

const MISS_A_DAY_DEEP_LINK = "stillpoint://session/quick";
const FRIEND_REQUEST_DEEP_LINK = "stillpoint://home";
const FRIEND_REQUEST_WEB_URL = "/app?view=friends";

function toApnsEnvironment(value: string): ApnsEnvironment {
  return value === "production" ? "production" : "development";
}

export async function sendPushNotificationToUser(params: {
  recipientUserId: string;
  payload: ApnsPayload;
}): Promise<{ delivered: boolean }> {
  const tokens = await db
    .select({
      id: deviceTokens.id,
      token: deviceTokens.token,
      apnsEnvironment: deviceTokens.apnsEnvironment,
    })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, params.recipientUserId), eq(deviceTokens.enabled, true)));

  if (tokens.length === 0) {
    return { delivered: false };
  }

  let delivered = false;

  for (let i = 0; i < tokens.length; i += PUSH_SEND_CONCURRENCY) {
    const batch = tokens.slice(i, i + PUSH_SEND_CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      try {
        const result = await sendApnsNotification(row.token, toApnsEnvironment(row.apnsEnvironment), params.payload);
        const now = new Date();
        if (result.ok) {
          delivered = true;
          await db.update(deviceTokens).set({ lastUsedAt: now, updatedAt: now }).where(eq(deviceTokens.id, row.id));
          return;
        }

        if (result.reason && invalidTokenReasons.has(result.reason)) {
          await db.update(deviceTokens).set({ enabled: false, updatedAt: now }).where(eq(deviceTokens.id, row.id));
        }
        console.warn("APNs notification failed", {
          tokenId: row.id,
          status: result.status,
          reason: result.reason,
          apnsId: result.apnsId,
        });
      } catch (error) {
        console.error("APNs notification error", { tokenId: row.id, error });
      }
    }));
  }

  return { delivered };
}

async function fanOutChannels(
  channel: string,
  tasks: Array<() => Promise<{ delivered: boolean } | void>>,
): Promise<boolean> {
  const results = await Promise.allSettled(tasks.map((task) => task()));
  const delivered = results.some((result) => {
    if (result.status === "rejected") {
      // Surface rejected channel promises so silent send failures are debuggable.
      console.error(`${channel} channel promise rejected`, { reason: result.reason });
      return false;
    }
    const value = result.value;
    return typeof value === "object" && value !== null && "delivered" in value && value.delivered === true;
  });

  if (!delivered) {
    console.warn(`${channel} not delivered on any channel`, {
      outcomes: results.map((result) =>
        result.status === "fulfilled" ? "fulfilled" : "rejected",
      ),
    });
  }

  return delivered;
}

export async function sendDailyReminderNotification(params: {
  recipientUserId: string;
  streak?: number;
}): Promise<{ delivered: boolean }> {
  const streak = params.streak ?? 0;
  const delivered = await fanOutChannels("daily_reminder", [
    () => sendPushNotificationToUser({
      recipientUserId: params.recipientUserId,
      payload: buildDailyReminderPayload(streak),
    }),
    () => sendWebPushToUser({
      recipientUserId: params.recipientUserId,
      payload: buildDailyReminderWebPushPayload(streak),
    }),
  ]);
  return { delivered };
}

export async function sendMissADayNotification(params: {
  recipientUserId: string;
}): Promise<{ delivered: boolean }> {
  const title = "Still Point";
  const body = "Missed yesterday — try a quick 1-min sit to get back.";

  const delivered = await fanOutChannels("miss_a_day", [
    () => sendPushNotificationToUser({
      recipientUserId: params.recipientUserId,
      payload: {
        aps: {
          alert: { title, body },
          sound: "default",
          "thread-id": "meditation-reminders",
        },
        type: MISS_A_DAY_NOTIFICATION_TYPE,
        deepLink: MISS_A_DAY_DEEP_LINK,
      },
    }),
    () => sendWebPushToUser({
      recipientUserId: params.recipientUserId,
      payload: {
        title,
        body,
        type: MISS_A_DAY_NOTIFICATION_TYPE,
        url: "/app",
      },
    }),
  ]);

  return { delivered };
}

export async function sendFriendRequestNotification(params: {
  recipientUserId: string;
  senderUsername: string;
  requestId: string;
}): Promise<void> {
  const title = "New friend request";
  const body = `${params.senderUsername} wants to connect on Still Point.`;

  await fanOutChannels("friend_request", [
    () => sendPushNotificationToUser({
      recipientUserId: params.recipientUserId,
      payload: {
        aps: {
          alert: { title, body },
          sound: "default",
          "thread-id": "friend-requests",
        },
        type: "friend_request",
        requestId: params.requestId,
        deepLink: FRIEND_REQUEST_DEEP_LINK,
      },
    }),
    () => sendWebPushToUser({
      recipientUserId: params.recipientUserId,
      payload: {
        title,
        body,
        type: "friend_request",
        url: FRIEND_REQUEST_WEB_URL,
      },
    }),
  ]);
}
