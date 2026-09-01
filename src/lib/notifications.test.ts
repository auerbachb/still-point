import { beforeEach, describe, expect, test, vi } from "vitest";

const tokenRows: Array<{ id: string; token: string; apnsEnvironment: "development" | "production" }> = [];
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));
const selectWhere = vi.fn();
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const sendApnsNotification = vi.fn();
const getApnsConfigStatus = vi.fn(() => ({ configured: true, missing: [] as string[] }));

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
  getApnsConfigStatus,
}));

const sendWebPushToUser = vi.fn();

vi.mock("@/lib/web-push", () => ({
  sendWebPushToUser,
}));

const isUserSessionActive = vi.fn();

vi.mock("@/lib/notifications/session-active", () => ({
  isUserSessionActive,
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
    getApnsConfigStatus.mockReturnValue({ configured: true, missing: [] });
    sendWebPushToUser.mockResolvedValue({ delivered: false });
    isUserSessionActive.mockResolvedValue(false);
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
    expect(sendWebPushToUser).toHaveBeenCalledWith({
      recipientUserId: "recipient-id",
      payload: {
        title: "New friend request",
        body: "maya wants to connect on Still Point.",
        type: "friend_request",
        url: "/app?view=friends",
      },
    });
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
      deepLink: "stillpoint://home",
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

  test("does not attempt an APNs send when APNs is not configured (#621)", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "production" });
    getApnsConfigStatus.mockReturnValue({
      configured: false,
      missing: ["APNS_BUNDLE_ID", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY"],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { sendPushNotificationToUser } = await import("./notifications");

      const result = await sendPushNotificationToUser({
        recipientUserId: "recipient-id",
        payload: { aps: { alert: { title: "Title", body: "Body" } } },
      });

      expect(result.delivered).toBe(false);
      expect(sendApnsNotification).not.toHaveBeenCalled();
      // Token stays enabled — a config error is not an APNs rejection.
      expect(dbUpdate).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        "APNs is not configured; skipping iOS push. Set the missing environment variables in this deployment.",
        expect.objectContaining({
          missing: ["APNS_BUNDLE_ID", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY"],
          affectedTokens: 1,
        }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("sends the daily reminder to APNs and Web Push", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" });
    const { sendDailyReminderNotification } = await import("./notifications");

    await sendDailyReminderNotification({ recipientUserId: "recipient-id" });

    expect(sendWebPushToUser).toHaveBeenCalledWith({
      recipientUserId: "recipient-id",
      payload: {
        title: "Still Point",
        body: "Time for a moment of stillness. Tap to begin.",
        type: "daily_reminder",
        url: "/app",
      },
    });
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

  test("sends the miss-a-day APNs payload with quick session deep link", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" });
    sendWebPushToUser.mockResolvedValue({ delivered: false });
    const { sendMissADayNotification } = await import("./notifications");

    const result = await sendMissADayNotification({ recipientUserId: "recipient-id" });

    expect(result.delivered).toBe(true);
    expect(sendApnsNotification).toHaveBeenCalledWith("a".repeat(64), "development", {
      aps: {
        alert: {
          title: "Still Point",
          body: "Missed yesterday — try a quick 1-min sit to get back.",
        },
        sound: "default",
        "thread-id": "meditation-reminders",
      },
      type: "miss_a_day",
      deepLink: "stillpoint://session/quick",
    });
  });

  test("sends the failure-reason reminder to APNs and Web Push with the dated deep link", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" });
    sendWebPushToUser.mockResolvedValue({ delivered: false });
    const { sendFailureReasonReminderNotification } = await import("./notifications");

    const result = await sendFailureReasonReminderNotification({
      recipientUserId: "recipient-id",
      targetDate: "2026-05-28",
      isYesterday: true,
    });

    expect(result.delivered).toBe(true);
    expect(sendApnsNotification).toHaveBeenCalledWith("a".repeat(64), "development", {
      aps: {
        alert: {
          title: "Still Point",
          body: "You didn't meditate yesterday. Take a moment to log why.",
        },
        sound: "default",
        "thread-id": "meditation-reminders",
      },
      type: "failure_reason_reminder",
      deepLink: "stillpoint://log-reason?date=2026-05-28",
    });
    expect(sendWebPushToUser).toHaveBeenCalledWith({
      recipientUserId: "recipient-id",
      payload: {
        title: "Still Point",
        body: "You didn't meditate yesterday. Take a moment to log why.",
        type: "failure_reason_reminder",
        url: "/app/log-reason?date=2026-05-28",
      },
    });
  });

  test("miss-a-day is not delivered when APNs and Web Push both fail", async () => {
    tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" });
    sendApnsNotification.mockResolvedValue({ ok: false, status: 500 });
    sendWebPushToUser.mockResolvedValue({ delivered: false });
    const { sendMissADayNotification } = await import("./notifications");

    const result = await sendMissADayNotification({ recipientUserId: "recipient-id" });

    expect(result.delivered).toBe(false);
    expect(sendApnsNotification).toHaveBeenCalledTimes(1);
  });

  test("logs rejected channel promises and failed deliveries (#440)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendWebPushToUser.mockRejectedValue(new Error("web push blew up"));
    // No device tokens -> APNs reports not delivered, web push promise rejects.
    const { sendDailyReminderNotification } = await import("./notifications");

    const result = await sendDailyReminderNotification({ recipientUserId: "recipient-id" });

    expect(result.delivered).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "daily_reminder channel promise rejected",
      expect.objectContaining({ reason: expect.any(Error) }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "daily_reminder not delivered on any channel",
      expect.objectContaining({ outcomes: expect.any(Array) }),
    );

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test("miss-a-day is delivered when only Web Push succeeds", async () => {
    sendWebPushToUser.mockResolvedValue({ delivered: true });
    const { sendMissADayNotification } = await import("./notifications");

    const result = await sendMissADayNotification({ recipientUserId: "recipient-id" });

    expect(result.delivered).toBe(true);
    expect(sendApnsNotification).not.toHaveBeenCalled();
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

  describe("during an active session (#709)", () => {
    beforeEach(() => {
      tokenRows.push({ id: "dt-1", token: "a".repeat(64), apnsEnvironment: "development" });
      isUserSessionActive.mockResolvedValue(true);
    });

    test("withholds a friend request push", async () => {
      const { sendFriendRequestNotification } = await import("./notifications");

      await sendFriendRequestNotification({
        recipientUserId: "recipient-id",
        senderUsername: "alex",
        requestId: "req-1",
      });

      expect(sendApnsNotification).not.toHaveBeenCalled();
      expect(sendWebPushToUser).not.toHaveBeenCalled();
    });

    test("withholds a scheduled reminder and reports it undelivered", async () => {
      const { sendDailyReminderNotification } = await import("./notifications");

      const result = await sendDailyReminderNotification({ recipientUserId: "recipient-id", streak: 3 });

      // delivered:false makes the scheduler release its dispatch claim, so the
      // reminder can be re-evaluated once the sit is over.
      expect(result.delivered).toBe(false);
      expect(sendApnsNotification).not.toHaveBeenCalled();
      expect(sendWebPushToUser).not.toHaveBeenCalled();
    });

    test("withholds the miss-a-day and failure-reason reminders", async () => {
      const { sendMissADayNotification, sendFailureReasonReminderNotification } =
        await import("./notifications");

      const missADay = await sendMissADayNotification({ recipientUserId: "recipient-id" });
      const failureReason = await sendFailureReasonReminderNotification({
        recipientUserId: "recipient-id",
        targetDate: "2026-06-01",
        isYesterday: false,
      });

      expect(missADay.delivered).toBe(false);
      expect(failureReason.delivered).toBe(false);
      expect(sendApnsNotification).not.toHaveBeenCalled();
      expect(sendWebPushToUser).not.toHaveBeenCalled();
    });
  });
});
