import { NextResponse } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

import { requireAuth } from "./requireAuth";

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns user when authenticated", async () => {
    getCurrentUser.mockResolvedValue({ userId: "u1", email: "a@b.com" });

    const result = await requireAuth();

    expect(result).toEqual({
      ok: true,
      user: { userId: "u1", email: "a@b.com" },
    });
  });

  test("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);

    const result = await requireAuth();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toEqual({ error: "Unauthorized" });
    }
  });
});
