import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPasswordResetToken,
  getPasswordResetPayload,
  hashResetToken,
  isPasswordResetRateLimited,
  normalizeResetEmail,
  recordPasswordResetAttempt,
  requestIpHash,
} from "./passwordReset";

describe("passwordReset (#539)", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-reset-secret-at-least-32-chars-long";
  });

  afterAll(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  test("round-trips a reset token and hashes it deterministically", async () => {
    const token = await createPasswordResetToken({ userId: "user-abc" });
    const payload = await getPasswordResetPayload(token);

    expect(payload).toEqual({
      userId: "user-abc",
      tokenHash: hashResetToken(token),
    });
  });

  test("returns null for tampered reset tokens", async () => {
    const token = await createPasswordResetToken({ userId: "user-abc" });
    const payload = await getPasswordResetPayload(`${token}x`);
    expect(payload).toBeNull();
  });

  test("rate limits repeated reset attempts per email/ip pair", async () => {
    const email = "reset539@test.local";
    const ipHash = "deadbeef";

    for (let i = 0; i < 5; i++) {
      recordPasswordResetAttempt(email, ipHash);
    }
    expect(isPasswordResetRateLimited(email, ipHash)).toBe(true);
    expect(isPasswordResetRateLimited(email, "other-ip")).toBe(false);
  });

  test("normalizes reset emails and request ip hashes", () => {
    expect(normalizeResetEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizeResetEmail("not-an-email")).toBe("");

    const request = new NextRequest("http://test.local/api/auth/password-reset", {
      headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.2" },
    });
    const ipHash = requestIpHash(request);
    expect(ipHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
