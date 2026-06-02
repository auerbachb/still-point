import { beforeEach, describe, expect, test, vi } from "vitest";

const subscriptionRows: Array<{
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}> = [];
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));
const selectWhere = vi.fn();
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const sendNotification = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    update: dbUpdate,
  },
}));

vi.mock("@/db/schema", () => ({
  webPushSubscriptions: {
    id: "id",
    endpoint: "endpoint",
    p256dh: "p256dh",
    auth: "auth",
    userId: "userId",
    enabled: "enabled",
    lastUsedAt: "lastUsedAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: sendNotification,
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("sendWebPushToUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    subscriptionRows.length = 0;
    selectWhere.mockResolvedValue(subscriptionRows);
    sendNotification.mockResolvedValue(undefined);
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "BPublicKey";
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "privateKey";
    process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:ops@still-point.me";
  });

  test("sends daily reminder payload to enabled subscriptions", async () => {
    subscriptionRows.push({
      id: "wps-1",
      endpoint: "https://push.example/1",
      p256dh: "p256",
      auth: "auth",
    });
    const { sendWebPushToUser } = await import("./web-push");

    await sendWebPushToUser({
      recipientUserId: "user-1",
      payload: {
        title: "Time for your sit",
        body: "Take a few minutes for your daily practice.",
        type: "daily_reminder",
        url: "/app",
      },
    });

    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: "https://push.example/1", keys: { p256dh: "p256", auth: "auth" } },
      JSON.stringify({
        title: "Time for your sit",
        body: "Take a few minutes for your daily practice.",
        type: "daily_reminder",
        url: "/app",
      }),
    );
    expect(dbUpdate).toHaveBeenCalled();
  });

  test("disables expired subscriptions", async () => {
    subscriptionRows.push({
      id: "wps-1",
      endpoint: "https://push.example/1",
      p256dh: "p256",
      auth: "auth",
    });
    sendNotification.mockRejectedValue({ statusCode: 410 });
    const { sendWebPushToUser } = await import("./web-push");

    await sendWebPushToUser({
      recipientUserId: "user-1",
      payload: { title: "T", body: "B", type: "daily_reminder" },
    });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  test("no-ops when VAPID is not configured", async () => {
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    subscriptionRows.push({
      id: "wps-1",
      endpoint: "https://push.example/1",
      p256dh: "p256",
      auth: "auth",
    });
    const { sendWebPushToUser } = await import("./web-push");

    await sendWebPushToUser({
      recipientUserId: "user-1",
      payload: { title: "T", body: "B", type: "daily_reminder" },
    });

    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("isValidPushSubscriptionInput", () => {
  test("accepts well-formed subscription JSON", async () => {
    const { isValidPushSubscriptionInput } = await import("./web-push");
    expect(isValidPushSubscriptionInput({
      endpoint: "https://push.example/sub",
      keys: { p256dh: "key", auth: "secret" },
    })).toBe(true);
  });
});
