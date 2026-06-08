import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const getCurrentUser = vi.fn();
const insertReturning = vi.fn();
const insertOnConflict = vi.fn(() => ({ returning: insertReturning }));
const insertValues = vi.fn(() => ({ onConflictDoUpdate: insertOnConflict }));
const dbInsert = vi.fn(() => ({ values: insertValues }));
const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", () => ({
  db: {
    insert: dbInsert,
    update: dbUpdate,
  },
}));
vi.mock("@/db/schema", () => ({
  webPushSubscriptions: {
    id: "id",
    endpointHash: "endpointHash",
    userId: "userId",
  },
}));
vi.mock("@/lib/web-push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/web-push")>();
  return {
    ...actual,
    getWebPushPublicKey: vi.fn(() => "BPublicKey"),
  };
});

describe("/api/notifications/push/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "BPublicKey";
    getCurrentUser.mockResolvedValue({ userId: "user-1" });
    insertReturning.mockResolvedValue([{ id: "sub-1" }]);
    updateReturning.mockResolvedValue([{ id: "sub-1" }]);
  });

  test("GET returns the VAPID public key", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    await expect(res.json()).resolves.toEqual({ publicKey: "BPublicKey" });
    expect(res.status).toBe(200);
  });

  test("POST registers a subscription for the authenticated user", async () => {
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/api/notifications/push/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: {
          endpoint: "https://push.example/sub",
          keys: { p256dh: "p256", auth: "auth" },
        },
      }),
    }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ subscription: { id: "sub-1" } });
    expect(dbInsert).toHaveBeenCalled();
  });

  test("DELETE disables a subscription by endpoint", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(new NextRequest("http://localhost/api/notifications/push/subscription", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: "https://push.example/sub" }),
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, removed: true });
    expect(dbUpdate).toHaveBeenCalled();
  });
});
