import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { passwordResetAppBaseUrl } from "./email";

describe("passwordResetAppBaseUrl", () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_URL;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("uses explicit NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://custom.example";
    expect(passwordResetAppBaseUrl()).toBe("https://custom.example");
  });

  it("uses still-point.me on Vercel production when unset", () => {
    process.env.VERCEL_ENV = "production";
    expect(passwordResetAppBaseUrl()).toBe("https://still-point.me");
  });

  it("uses VERCEL_URL on preview when unset", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "my-app-git-branch.vercel.app";
    expect(passwordResetAppBaseUrl()).toBe("https://my-app-git-branch.vercel.app");
  });

  it("uses localhost in non-production without Vercel", () => {
    process.env.NODE_ENV = "development";
    expect(passwordResetAppBaseUrl()).toBe("http://127.0.0.1:3000");
  });

  it("uses still-point.me in production without Vercel", () => {
    process.env.NODE_ENV = "production";
    expect(passwordResetAppBaseUrl()).toBe("https://still-point.me");
  });
});
