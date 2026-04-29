import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// HTTP-driver path (no username): db.update(...).set(...).where(...).returning(...)
const dbUpdateReturning = vi.fn();
const dbUpdateWhere = vi.fn(() => ({ returning: dbUpdateReturning }));
const dbUpdateSet = vi.fn((_values: Record<string, unknown>) => ({ where: dbUpdateWhere }));
const dbUpdate = vi.fn(() => ({ set: dbUpdateSet }));

// Transactional path (username present): poolDb.transaction(async (tx) => ...)
const txExecute = vi.fn();
const txSelectLimit = vi.fn();
const txSelectWhere = vi.fn(() => ({ limit: txSelectLimit }));
const txSelectFrom = vi.fn(() => ({ where: txSelectWhere }));
const txSelect = vi.fn(() => ({ from: txSelectFrom }));
const txUpdateReturning = vi.fn();
const txUpdateWhere = vi.fn(() => ({ returning: txUpdateReturning }));
const txUpdateSet = vi.fn((_values: Record<string, unknown>) => ({ where: txUpdateWhere }));
const txUpdate = vi.fn(() => ({ set: txUpdateSet }));

const poolTransaction = vi.fn(
  async (cb: (tx: { execute: typeof txExecute; select: typeof txSelect; update: typeof txUpdate }) => unknown) =>
    cb({ execute: txExecute, select: txSelect, update: txUpdate }),
);

const getCurrentUser = vi.fn();

vi.mock("@/db", () => ({ db: { update: dbUpdate } }));
vi.mock("@/db/pool", () => ({ poolDb: { transaction: poolTransaction } }));

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
    txSelectLimit.mockResolvedValue([]);
    txExecute.mockResolvedValue(undefined);
    txUpdateReturning.mockResolvedValue([
      {
        id: userId,
        email: "user@example.com",
        username: "newname",
        isPublic: false,
        currentDay: 1,
      },
    ]);
    dbUpdateReturning.mockResolvedValue([
      {
        id: userId,
        email: "user@example.com",
        username: "existing",
        isPublic: true,
        currentDay: 1,
      },
    ]);
  });

  test("rejects unauthenticated callers", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "newname" }));

    expect(res.status).toBe(401);
    expect(poolTransaction).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("rejects usernames that violate the format rules", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "no" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Username must be 3-30 characters (letters, numbers, underscores)",
    });
    expect(poolTransaction).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("acquires advisory lock and rejects when another user holds the username", async () => {
    txSelectLimit.mockResolvedValue([{ id: "other-user" }]);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "Taken" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Username already taken" });

    expect(poolTransaction).toHaveBeenCalledTimes(1);
    expect(txExecute).toHaveBeenCalledTimes(1);
    const lockArg = txExecute.mock.calls[0]![0] as { sql: { values: unknown[] } };
    // Lock key is hashtext("username:" + lower(username)) — verify case is folded.
    expect(lockArg.sql.values).toContain("username:taken");
    expect(txUpdate).not.toHaveBeenCalled();
  });

  test("updates the username inside the transaction when valid and unique", async () => {
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
    expect(poolTransaction).toHaveBeenCalledTimes(1);
    expect(txExecute).toHaveBeenCalledTimes(1);
    expect(txUpdateSet).toHaveBeenCalledTimes(1);
    const updates = txUpdateSet.mock.calls[0]![0];
    expect(updates.username).toBe("newname");
    expect(updates.updatedAt).toBeInstanceOf(Date);
    // The HTTP-driver fall-through must not fire when username is being updated.
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("translates Postgres unique-violation races into 409", async () => {
    txUpdateReturning.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "racy" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Username already taken" });
  });

  test("isPublic-only updates skip the transaction and use the HTTP driver", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ isPublic: true }));

    expect(res.status).toBe(200);
    expect(poolTransaction).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    const updates = dbUpdateSet.mock.calls[0]![0];
    expect(updates.isPublic).toBe(true);
    expect(updates).not.toHaveProperty("username");
  });
});
