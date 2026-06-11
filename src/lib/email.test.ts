import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { passwordResetAppBaseUrl } from "./email";

describe("passwordResetAppBaseUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses explicit NEXT_PUBLIC_APP_URL when set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://custom.example");
    expect(passwordResetAppBaseUrl()).toBe("https://custom.example");
  });

  it("uses still-point.me on Vercel production when unset", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(passwordResetAppBaseUrl()).toBe("https://still-point.me");
  });

  it("uses VERCEL_URL on preview when unset", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "my-app-git-branch.vercel.app");
    expect(passwordResetAppBaseUrl()).toBe("https://my-app-git-branch.vercel.app");
  });

  it("uses localhost in non-production without Vercel", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(passwordResetAppBaseUrl()).toBe("http://127.0.0.1:3000");
  });

  it("uses still-point.me in production without Vercel", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(passwordResetAppBaseUrl()).toBe("https://still-point.me");
  });
});
