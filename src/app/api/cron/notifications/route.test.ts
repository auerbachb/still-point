import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const runNotificationScheduler = vi.fn();

vi.mock("@/lib/notificationScheduler", () => ({
  runNotificationScheduler,
}));

describe("GET /api/cron/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    runNotificationScheduler.mockResolvedValue({
      evaluated: 1,
      eligible: 1,
      sent: 1,
      skipped: {},
      errors: 0,
    });
  });

  test("returns 401 without bearer secret", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/cron/notifications"));
    expect(response.status).toBe(401);
    expect(runNotificationScheduler).not.toHaveBeenCalled();
  });

  test("runs scheduler when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/cron/notifications", {
        headers: { authorization: "Bearer test-secret" },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(1);
    expect(runNotificationScheduler).toHaveBeenCalledTimes(1);
  });
});
