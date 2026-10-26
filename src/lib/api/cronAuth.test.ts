import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { isAuthorizedCron } from "./cronAuth";

function cronRequest(authorization?: string): NextRequest {
  return new NextRequest("http://test.local/api/cron/purge-consent-events", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("isAuthorizedCron", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("with CRON_SECRET set, accepts only the exact bearer header", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "test-secret");

    expect(isAuthorizedCron(cronRequest("Bearer test-secret"))).toBe(true);
    expect(isAuthorizedCron(cronRequest())).toBe(false);
    expect(isAuthorizedCron(cronRequest("Bearer wrong-secret"))).toBe(false);
    expect(isAuthorizedCron(cronRequest("test-secret"))).toBe(false);
  });

  test("without CRON_SECRET, allows requests outside production only", () => {
    vi.stubEnv("CRON_SECRET", "");

    vi.stubEnv("NODE_ENV", "development");
    expect(isAuthorizedCron(cronRequest())).toBe(true);

    vi.stubEnv("NODE_ENV", "production");
    expect(isAuthorizedCron(cronRequest())).toBe(false);
    expect(isAuthorizedCron(cronRequest("Bearer anything"))).toBe(false);
  });
});
