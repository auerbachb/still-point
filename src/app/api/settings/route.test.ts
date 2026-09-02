import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const atomicUpdateUsername = vi.fn();
const dbUpdateReturning = vi.fn();
const dbUpdateWhere = vi.fn(() => ({ returning: dbUpdateReturning }));
const dbUpdateSet = vi.fn((_values: Record<string, unknown>) => ({ where: dbUpdateWhere }));
const dbUpdate = vi.fn(() => ({ set: dbUpdateSet }));

const getCurrentUser = vi.fn();

vi.mock("@/db", () => ({ db: { update: dbUpdate } }));
vi.mock("@/db/atomic", () => ({ atomicUpdateUsername }));

vi.mock("@/db/schema", () => ({
  users: {
    id: "id",
    email: "email",
    username: "username",
    isPublic: "isPublic",
    currentDay: "currentDay",
    aphorismsEnabled: "aphorismsEnabled",
    attentionTrackingEnabled: "attentionTrackingEnabled",
    ambientSoundEnabled: "ambientSoundEnabled",
    dualTrackEnabled: "dualTrackEnabled",
    secondTrackDay: "secondTrackDay",
    recoveryTargetDay: "recoveryTargetDay",
    recoveryCurrentStep: "recoveryCurrentStep",
    recoveryTotalSteps: "recoveryTotalSteps",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/username", () => ({
  USERNAME_ERROR:
    "Username must be 3-30 characters (letters, numbers, underscores)",
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 30,
  USERNAME_REGEX: /^[a-zA-Z0-9_]+$/,
  isValidUsername: (value: string) =>
    value.length >= 3 && value.length <= 30 && /^[a-zA-Z0-9_]+$/.test(value),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
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
    atomicUpdateUsername.mockResolvedValue({
      ok: true,
      user: {
        id: userId,
        email: "user@example.com",
        username: "newname",
        isPublic: false,
        currentDay: 1,
      },
    });
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
    expect(atomicUpdateUsername).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("rejects usernames that violate the format rules", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "no" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Username must be 3-30 characters (letters, numbers, underscores)",
    });
    expect(atomicUpdateUsername).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("rejects when another user holds the username", async () => {
    atomicUpdateUsername.mockResolvedValue({ ok: false, reason: "taken" });
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "Taken" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Username already taken" });
    expect(atomicUpdateUsername).toHaveBeenCalledTimes(1);
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
    expect(atomicUpdateUsername).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        username: "newname",
      }),
    );
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("translates Postgres unique-violation races into 409", async () => {
    atomicUpdateUsername.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ username: "racy" }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "Username already taken" });
  });

  test("rejects PATCH bodies without any supported settings", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ unrelated: "noise" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "No supported settings provided",
    });
    expect(atomicUpdateUsername).not.toHaveBeenCalled();
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  test("isPublic-only updates skip username atomic path and use the HTTP driver", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ isPublic: true }));

    expect(res.status).toBe(200);
    expect(atomicUpdateUsername).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    const updates = dbUpdateSet.mock.calls[0]![0];
    expect(updates.isPublic).toBe(true);
    expect(updates).not.toHaveProperty("username");
  });

  test("attentionTrackingEnabled-only updates skip username atomic path and use the HTTP driver", async () => {
    dbUpdateReturning.mockResolvedValue([
      {
        id: userId,
        email: "user@example.com",
        username: "existing",
        isPublic: true,
        currentDay: 1,
        aphorismsEnabled: false,
        attentionTrackingEnabled: true,
        dualTrackEnabled: false,
        secondTrackDay: 1,
      },
    ]);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ attentionTrackingEnabled: true }));

    expect(res.status).toBe(200);
    expect(atomicUpdateUsername).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    const updates = dbUpdateSet.mock.calls[0]![0];
    expect(updates.attentionTrackingEnabled).toBe(true);
    expect(updates).not.toHaveProperty("username");
  });

  test("aphorismsEnabled-only updates skip username atomic path and use the HTTP driver", async () => {
    dbUpdateReturning.mockResolvedValue([
      {
        id: userId,
        email: "user@example.com",
        username: "existing",
        isPublic: true,
        currentDay: 1,
        aphorismsEnabled: true,
      },
    ]);
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ aphorismsEnabled: true }));

    expect(res.status).toBe(200);
    expect(atomicUpdateUsername).not.toHaveBeenCalled();
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    const updates = dbUpdateSet.mock.calls[0]![0];
    expect(updates.aphorismsEnabled).toBe(true);
    expect(updates).not.toHaveProperty("username");
    await expect(res.json()).resolves.toEqual({
      user: {
        id: userId,
        email: "user@example.com",
        username: "existing",
        isPublic: true,
        currentDay: 1,
        aphorismsEnabled: true,
      },
    });
  });

  // Issue #664: iOS adopts a settings response wholesale, so an omitted column
  // is nulled on the device. The projection must carry the recovery trio.
  test("returns the recovery columns in the PATCH projection", async () => {
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ isPublic: true }));

    expect(res.status).toBe(200);
    expect(dbUpdateReturning).toHaveBeenCalledTimes(1);
    const projection = dbUpdateReturning.mock.calls[0]![0];
    expect(projection).toMatchObject({
      recoveryTargetDay: "recoveryTargetDay",
      recoveryCurrentStep: "recoveryCurrentStep",
      recoveryTotalSteps: "recoveryTotalSteps",
    });
  });

  test("round-trips an active recovery ramp in the response body", async () => {
    const storedRow: Record<string, unknown> = {
      id: userId,
      email: "user@example.com",
      username: "existing",
      isPublic: true,
      currentDay: 3,
      aphorismsEnabled: false,
      attentionTrackingEnabled: false,
      ambientSoundEnabled: false,
      dualTrackEnabled: false,
      secondTrackDay: 1,
      recoveryTargetDay: 12,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 4,
    };
    // Project the stored row through whatever the route asked for, as the real
    // driver does — otherwise a mock that echoes a fixed row would pass even
    // with the recovery columns missing from RETURN_FIELDS.
    dbUpdateReturning.mockImplementation((projection: Record<string, unknown>) =>
      Promise.resolve([
        Object.fromEntries(
          Object.keys(projection).map((column) => [column, storedRow[column]]),
        ),
      ]),
    );
    const { PATCH } = await import("./route");

    const res = await PATCH(buildRequest({ ambientSoundEnabled: false }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      user: {
        recoveryTargetDay: 12,
        recoveryCurrentStep: 2,
        recoveryTotalSteps: 4,
      },
    });
  });
});
