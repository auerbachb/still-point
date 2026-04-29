import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const updateReturning = vi.fn();
const updateWhere = vi.fn(() => ({ returning: updateReturning }));
const updateSet = vi.fn((_values: Record<string, unknown>) => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));

const getCurrentUser = vi.fn();

vi.mock("@/db", () => ({
  db: {
    update: dbUpdate,
    select: dbSelect,
  },
}));

vi.mock("@/db/schema", () => ({
  users: {
    id: "id",
    email: "email",
    username: "username",
    isPublic: "isPublic",
    currentDay: "currentDay",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  ne: (left: unknown, right: unknown) => ({ ne: [left, right] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: { strings: Array.from(strings), values },
  }),
}));

const userId = "user-1";

const buildRequest = (body: unknown) =>
  new Request("http://test.local/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as NextRequest;

describe("PATCH /api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ userId, email: "user@example.com" });
    selectLimit.mockResolvedValue([]);
    updateReturning.mockResolvedValue([
      {
        id: userId,
        email: "user@example.com",
        username: "newname",
        isPublic: false,
        currentDay: 1,
      },
    ]);
  });

  test("rejects unauthenticated callers", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "newname" }));

    expect(res.status).toBe(401);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("rejects usernames that violate the format rules", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "no" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Username must be 3-30 characters (letters, numbers, underscores)",
    });
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("rejects usernames that another user already holds", async () => {
    selectLimit.mockResolvedValue([{ id: "other-user" }]);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "taken" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Username already taken" });
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("updates the username when valid and unique", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "  newname  " }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      user: {
        id: userId,
        email: "user@example.com",
        username: "newname",
        isPublic: false,
        currentDay: 1,
      },
    });
    expect(updateSet).toHaveBeenCalledTimes(1);
    const updates = updateSet.mock.calls[0]![0];
    expect(updates.username).toBe("newname");
    expect(updates.updatedAt).toBeInstanceOf(Date);
  });

  test("translates Postgres unique-violation races into 409", async () => {
    updateReturning.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "racy" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Username already taken" });
  });

  test("still supports the existing isPublic toggle without touching username", async () => {
    updateReturning.mockResolvedValue([
      {
        id: userId,
        email: "user@example.com",
        username: "existing",
        isPublic: true,
        currentDay: 1,
      },
    ]);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ isPublic: true }));

    expect(res.status).toBe(200);
    expect(dbSelect).not.toHaveBeenCalled();
    const updates = updateSet.mock.calls[0]![0];
    expect(updates.isPublic).toBe(true);
    expect(updates).not.toHaveProperty("username");
  });
});
