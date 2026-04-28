import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deviceTokens } from "@/db/schema";
import { type ApnsEnvironment, type ApnsPayload, sendApnsNotification } from "@/lib/apns";

const invalidTokenReasons = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);
const PUSH_SEND_CONCURRENCY = 3;

function toApnsEnvironment(value: string): ApnsEnvironment {
  return value === "production" ? "production" : "development";
}

export async function sendPushNotificationToUser(params: {
  recipientUserId: string;
  payload: ApnsPayload;
}): Promise<void> {
  const tokens = await db
    .select({
      id: deviceTokens.id,
      token: deviceTokens.token,
      apnsEnvironment: deviceTokens.apnsEnvironment,
    })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, params.recipientUserId), eq(deviceTokens.enabled, true)));

  for (let i = 0; i < tokens.length; i += PUSH_SEND_CONCURRENCY) {
    const batch = tokens.slice(i, i + PUSH_SEND_CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      try {
        const result = await sendApnsNotification(row.token, toApnsEnvironment(row.apnsEnvironment), params.payload);
        const now = new Date();
        if (result.ok) {
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
}

export async function sendFriendRequestNotification(params: {
  recipientUserId: string;
  senderUsername: string;
  requestId: string;
}): Promise<void> {
  await sendPushNotificationToUser({
    recipientUserId: params.recipientUserId,
    payload: {
      aps: {
        alert: {
          title: "New friend request",
          body: `${params.senderUsername} wants to connect on Still Point.`,
        },
        sound: "default",
        "thread-id": "friend-requests",
      },
      type: "friend_request",
      requestId: params.requestId,
    },
  });
}
