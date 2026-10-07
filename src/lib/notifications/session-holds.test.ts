import { beforeEach, describe, expect, test, vi } from "vitest";

const now = new Date("2026-06-01T12:00:00.000Z");
const otherHold = new Date("2026-06-01T12:02:00.000Z");

const onConflictDoUpdate = vi.fn(async () => undefined);
const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
const dbInsert = vi.fn(() => ({ values: insertValues }));

const deleteWhere = vi.fn(async () => undefined);
const dbDelete = vi.fn(() => ({ where: deleteWhere }));

let selectRows: Array<{ expiresAt: Date }> = [];
const limit = vi.fn(async () => selectRows);
const orderBy = vi.fn(() => ({ limit }));
const selectWhere = vi.fn(() => ({ orderBy }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));

let updateReturningRows: Array<Record<string, unknown>> = [];
const updateReturning = vi.fn(async () => updateReturningRows);
const updateSet = vi.fn();
const updateWhere = vi.fn(() => {
  const pending = Promise.resolve(undefined);
  return Object.assign(pending, { returning: updateReturning });
});
updateSet.mockImplementation(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

vi.mock("@/db", () => ({
  db: {
    insert: dbInsert,
    delete: dbDelete,
    select: dbSelect,
    update: dbUpdate,
  },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    userId: "userId",
    suppressDuringSession: "suppressDuringSession",
    sessionActiveUntil: "sessionActiveUntil",
  },
  sessionNotificationHolds: {
    userId: "holdUserId",
    sessionKey: "holdSessionKey",
    expiresAt: "expiresAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ and: conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ gt: [left, right] })),
  desc: vi.fn((column: unknown) => ({ desc: column })),
}));

describe("session holds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectRows = [];
    updateReturningRows = [];
    updateSet.mockImplementation(() => ({ where: updateWhere }));
  });

  test("take refreshes one sit and stores its expiry", async () => {
    const expiresAt = new Date(now.getTime() + 3 * 60 * 1000);
    updateReturningRows = [{
      sessionActiveUntil: expiresAt,
      suppressDuringSession: true,
    }];
    const { applyKeyedSessionState } = await import("./session-holds");

    const result = await applyKeyedSessionState({
      userId: "user-1",
      sessionKey: "sit-a",
      active: true,
      suppressDuringSession: true,
      now,
    });

    expect(result.sessionActiveUntil).toBe(expiresAt.toISOString());
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      sessionKey: "sit-a",
      expiresAt,
    }));
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });

  test("take does nothing when the preference was turned off before the write", async () => {
    updateReturningRows = [];
    const { applyKeyedSessionState } = await import("./session-holds");

    const result = await applyKeyedSessionState({
      userId: "user-1",
      sessionKey: "sit-a",
      active: true,
      suppressDuringSession: true,
      now,
    });

    expect(result).toEqual({ sessionActiveUntil: null, suppressDuringSession: false });
    expect(dbInsert).toHaveBeenCalled();
    expect(dbDelete).toHaveBeenCalled();
  });

  test("release deletes only the caller's row and keeps another sit's expiry", async () => {
    selectRows = [{ expiresAt: otherHold }];
    const { applyKeyedSessionState } = await import("./session-holds");

    const result = await applyKeyedSessionState({
      userId: "user-1",
      sessionKey: "sit-a",
      active: false,
      suppressDuringSession: true,
      now,
    });

    expect(dbDelete).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
    expect(dbInsert).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ sessionActiveUntil: otherHold });
    expect(result.sessionActiveUntil).toBe(otherHold.toISOString());
  });

  test("a fully expired set clears the derived column", async () => {
    selectRows = [];
    const { maxUnexpiredHoldExpiry, applyKeyedSessionState } = await import("./session-holds");

    await expect(maxUnexpiredHoldExpiry("user-1", now)).resolves.toBeNull();
    const result = await applyKeyedSessionState({
      userId: "user-1",
      sessionKey: "sit-a",
      active: false,
      suppressDuringSession: true,
      now,
    });

    expect(updateSet).toHaveBeenCalledWith({ sessionActiveUntil: null });
    expect(result.sessionActiveUntil).toBeNull();
  });
});
