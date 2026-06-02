import { beforeEach, describe, expect, test, vi } from "vitest";

const tokenRows: Array<{ id: string; token: string; apnsEnvironment: "development" | "production" }> = [];
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));
const selectWhere = vi.fn();
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const sendApnsNotification = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    update: dbUpdate,
  },
}));

vi.mock("@/db/schema", () => ({
  deviceTokens: {
    id: "id",
    token: "token",
    apnsEnvironment: "apnsEnvironment",
    userId: "userId",
    enabled: "enabled",
    lastUsedAt: "lastUsedAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("@/lib/apns", () => ({
  sendApnsNotification,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("sendFriendRequestNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenRows.length = 0;
    selectWhere.mockResolvedValue(tokenRows);
    sendApnsNotification.mockResolvedValue({ ok: true, status: 200 });
  });

  test("sends the friend request APNs payload to each enabled device token", async () => {
    tokenRows.push(
      { id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" },
      { id: "dt-2", token: "b".repeat(64), apnsEnvironment: "production" },
    );
    const { sendFriendRequestNotification } = await import("./notifications");

    await sendFriendRequestNotification({
      recipientUserId: "recipient-id",
      senderUsername: "maya",
      requestId: "request-id",
    });

    expect(sendApnsNotification).toHaveBeenCalledTimes(2);
    expect(sendApnsNotification).toHaveBeenCalledWith("a".repeat(64), "development", {
      aps: {
        alert: {
          title: "New friend request",
          body: "maya wants to connect on Still Point.",
        },
        sound: "default",
        "thread-id": "friend-requests",
      },
      type: "friend_request",
      requestId: "request-id",
    });
    expect(dbUpdate).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: expect.any(Date) }));
  });

  test("does not require APNs credentials when the recipient has no device tokens", async () => {
    const { sendFriendRequestNotification } = await import("./notifications");

    await sendFriendRequestNotification({
      recipientUserId: "recipient-id",
      senderUsername: "maya",
      requestId: "request-id",
    });

    expect(sendApnsNotification).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("disables invalid APNs tokens", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "production" });
    sendApnsNotification.mockResolvedValue({ ok: false, status: 410, reason: "Unregistered" });
    const { sendPushNotificationToUser } = await import("./notifications");

    await sendPushNotificationToUser({
      recipientUserId: "recipient-id",
      payload: { aps: { alert: { title: "Title", body: "Body" } } },
    });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  test("sends the daily reminder APNs payload", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" });
    const { sendDailyReminderNotification } = await import("./notifications");

    await sendDailyReminderNotification({ recipientUserId: "recipient-id" });

    expect(sendApnsNotification).toHaveBeenCalledWith("a".repeat(64), "development", {
      aps: {
        alert: {
          title: "Still Point",
          body: "Time for a moment of stillness. Tap to begin.",
        },
        sound: "default",
        "thread-id": "daily-reminder",
      },
      type: "daily_reminder",
      deepLink: "stillpoint://home",
    });
  });

  test("limits APNs sends to bounded batches", async () => {
    for (let i = 0; i < 7; i += 1) {
      tokenRows.push({ id: `dt-${i}`, token: `${i}`.repeat(64), apnsEnvironment: "development" });
    }

    let inFlight = 0;
    let maxInFlight = 0;
    sendApnsNotification.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return { ok: true, status: 200 };
    });

    const { sendPushNotificationToUser } = await import("./notifications");
    await sendPushNotificationToUser({
      recipientUserId: "recipient-id",
      payload: { aps: { alert: { title: "Title", body: "Body" } } },
    });

    expect(sendApnsNotification).toHaveBeenCalledTimes(7);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });
});
