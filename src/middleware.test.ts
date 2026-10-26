import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { middleware } from "./middleware";

/** What Vercel Cron sends: a shared secret, not an sp_token JWT. */
function cronBearerRequest(pathname: string): NextRequest {
  return new NextRequest(`http://test.local${pathname}`, {
    headers: { authorization: "Bearer cron-secret-not-a-jwt" },
  });
}

describe("middleware — cron routes (#789)", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-jwt-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each(["/api/cron/dispatch-notifications", "/api/cron/purge-consent-events"])(
    "lets %s through to the route's own CRON_SECRET check",
    async (pathname) => {
      const response = await middleware(cronBearerRequest(pathname));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-middleware-next")).toBe("1");
    },
  );

  test("still rejects the same bearer on a protected route", async () => {
    const response = await middleware(cronBearerRequest("/api/sessions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Invalid token" });
  });
});
