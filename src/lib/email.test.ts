import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { passwordResetAppBaseUrl } from "./email";

describe("passwordResetAppBaseUrl", () => {
  const env = { ...process.env };
  const setNodeEnv = (value: string) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = value;
  };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_URL;
    setNodeEnv("test");
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
    setNodeEnv("development");
    expect(passwordResetAppBaseUrl()).toBe("http://127.0.0.1:3000");
  });

  it("uses still-point.me in production without Vercel", () => {
    setNodeEnv("production");
    expect(passwordResetAppBaseUrl()).toBe("https://still-point.me");
  });
});
