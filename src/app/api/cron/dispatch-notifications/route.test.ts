import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const dispatchDueNotifications = vi.fn();

vi.mock("@/lib/notification-scheduler", () => ({
  dispatchDueNotifications,
}));

describe("/api/cron/dispatch-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    dispatchDueNotifications.mockResolvedValue({ scanned: 0, sent: 0, skipped: 0 });
    delete process.env.CRON_SECRET;
  });

  test("returns 401 without cron secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "test-secret");

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/cron/dispatch-notifications") as NextRequest,
    );

    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  test("dispatches when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    dispatchDueNotifications.mockResolvedValue({ scanned: 2, sent: 1, skipped: 1 });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/cron/dispatch-notifications", {
        headers: { authorization: "Bearer test-secret" },
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      scanned: 2,
      sent: 1,
      skipped: 1,
    });
    vi.unstubAllEnvs();
  });
});
