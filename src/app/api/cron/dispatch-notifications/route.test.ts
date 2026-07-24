import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const dispatchDueNotifications = vi.fn();
const getApnsConfigStatus = vi.fn(() => ({ configured: true, missing: [] as string[] }));

vi.mock("@/lib/notification-scheduler", () => ({
  dispatchDueNotifications,
}));

vi.mock("@/lib/apns", () => ({
  getApnsConfigStatus,
}));

describe("/api/cron/dispatch-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    dispatchDueNotifications.mockResolvedValue({ scanned: 0, sent: 0, skipped: 0 });
    getApnsConfigStatus.mockReturnValue({ configured: true, missing: [] });
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

  test("dispatches when authorized and reports APNs configured", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    dispatchDueNotifications.mockResolvedValue({ scanned: 2, sent: 1, skipped: 1, callsInitiated: 0, callCandidatesScanned: 1 });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/cron/dispatch-notifications", {
        headers: { authorization: "Bearer test-secret" },
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      apnsConfigured: true,
      scanned: 2,
      callCandidatesScanned: 1,
      sent: 1,
      skipped: 1,
      callsInitiated: 0,
    });
    vi.unstubAllEnvs();
  });

  test("surfaces apnsConfigured:false and the missing vars when APNs is unconfigured (#621)", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    dispatchDueNotifications.mockResolvedValue({ scanned: 3, sent: 0, skipped: 3 });
    getApnsConfigStatus.mockReturnValue({
      configured: false,
      missing: ["APNS_BUNDLE_ID", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY"],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/cron/dispatch-notifications", {
        headers: { authorization: "Bearer test-secret" },
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      apnsConfigured: false,
      apnsMissing: ["APNS_BUNDLE_ID", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY"],
      scanned: 3,
      sent: 0,
      skipped: 3,
    });
    expect(errorSpy).toHaveBeenCalledWith("dispatch-notifications: APNs is not configured", {
      missing: ["APNS_BUNDLE_ID", "APNS_TEAM_ID", "APNS_KEY_ID", "APNS_PRIVATE_KEY"],
    });
    errorSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});
