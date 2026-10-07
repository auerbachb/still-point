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

const dbExecute = vi.fn(async (_query: unknown) => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/db", () => ({
  db: {
    insert: dbInsert,
    delete: dbDelete,
    select: dbSelect,
    update: dbUpdate,
    execute: dbExecute,
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
  lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
  desc: vi.fn((column: unknown) => ({ desc: column })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    values,
  }),
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

  test("release recomputes the shared column in the same statement as the delete", async () => {
    dbExecute.mockResolvedValueOnce({
      rows: [{ session_active_until: otherHold.toISOString() }],
    });
    const { applyKeyedSessionState } = await import("./session-holds");

    const result = await applyKeyedSessionState({
      userId: "user-1",
      sessionKey: "sit-a",
      active: false,
      suppressDuringSession: true,
      now,
    });

    const statement = JSON.stringify(dbExecute.mock.calls[0]?.[0]).toLowerCase();
    expect(statement).toContain("delete from session_notification_holds");
    expect(statement).toContain("max(holds.expires_at)");
    expect(statement).toContain("session_key");
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

    expect(updateSet).not.toHaveBeenCalled();
    expect(result.sessionActiveUntil).toBeNull();
  });
});
