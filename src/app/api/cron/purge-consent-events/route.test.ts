import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const purgeExpiredConsentEvents = vi.fn();

vi.mock("@/lib/consent-retention", () => ({
  purgeExpiredConsentEvents,
}));

function cronRequest(headers?: Record<string, string>): NextRequest {
  return new Request("http://test.local/api/cron/purge-consent-events", { headers }) as NextRequest;
}

describe("/api/cron/purge-consent-events (#789)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    purgeExpiredConsentEvents.mockResolvedValue({
      cutoff: new Date("2026-06-15T12:00:00.000Z"),
      deletedEvents: 0,
      purgedGroups: 0,
    });
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("returns 401 without the cron secret in production and purges nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "test-secret");

    const { GET } = await import("./route");
    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(purgeExpiredConsentEvents).not.toHaveBeenCalled();
  });

  test("returns 401 for an incorrect bearer token and purges nothing", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    const { GET } = await import("./route");
    const response = await GET(cronRequest({ authorization: "Bearer wrong-secret" }));

    expect(response.status).toBe(401);
    expect(purgeExpiredConsentEvents).not.toHaveBeenCalled();
  });

  test("purges at the current time and reports the metrics when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    purgeExpiredConsentEvents.mockResolvedValue({
      cutoff: new Date("2026-06-15T12:00:00.000Z"),
      deletedEvents: 6,
      purgedGroups: 3,
    });

    const { GET, POST } = await import("./route");
    const response = await GET(cronRequest({ authorization: "Bearer test-secret" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cutoff: "2026-06-15T12:00:00.000Z",
      deletedEvents: 6,
      purgedGroups: 3,
    });
    expect(purgeExpiredConsentEvents).toHaveBeenCalledTimes(1);
    expect(purgeExpiredConsentEvents).toHaveBeenCalledWith();

    const postResponse = await POST(cronRequest({ authorization: "Bearer test-secret" }));
    expect(postResponse.status).toBe(200);
    expect(purgeExpiredConsentEvents).toHaveBeenCalledTimes(2);
  });

  test("returns the standard 500 when the purge fails", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const failure = new Error("database unavailable");
    purgeExpiredConsentEvents.mockRejectedValue(failure);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("./route");
    const response = await GET(cronRequest({ authorization: "Bearer test-secret" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
    expect(errorSpy).toHaveBeenCalledWith("purge-consent-events cron error:", failure);
    errorSpy.mockRestore();
  });
});
