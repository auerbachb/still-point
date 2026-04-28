import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const syncBuddySessionCalendarForUser = vi.fn();
const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const dbInsert = vi.fn(() => ({ values: insertValues }));

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
  },
}));

vi.mock("@/db/schema", () => ({
  buddySessions: {},
  buddySessionParticipants: {},
  users: {
    id: "users.id",
    currentDay: "users.currentDay",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/buddySession", () => ({
  buddyDurationForDay: vi.fn(() => 600),
}));

vi.mock("@/lib/google", () => ({
  syncBuddySessionCalendarForUser,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("POST /api/buddy/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "user@example.com" });
    selectLimit.mockResolvedValue([{ currentDay: 1 }]);
    insertReturning.mockResolvedValue([
      {
        id: "session-1",
        shareToken: "share-token",
        durationSeconds: 600,
        scheduledStartAt: null,
      },
    ]);
    syncBuddySessionCalendarForUser.mockResolvedValue({
      status: "skipped",
      userId: "user-1",
      reason: "not_connected",
    });
  });

  test("rejects a scheduled start in the past", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/buddy/sessions", {
        method: "POST",
        body: JSON.stringify({ scheduledStartAt: "2000-01-01T00:00:00.000Z" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({
      error: "scheduledStartAt must be in the future",
    });
    expect(response.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  test("stores a future scheduled start and syncs the host calendar", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    insertReturning.mockResolvedValue([
      {
        id: "session-1",
        shareToken: "share-token",
        durationSeconds: 600,
        scheduledStartAt: new Date(future),
      },
    ]);
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/buddy/sessions", {
        method: "POST",
        body: JSON.stringify({ scheduledStartAt: future }),
      }) as NextRequest,
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledStartAt: expect.any(Date),
        state: "waiting",
      }),
    );
    expect(syncBuddySessionCalendarForUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1" }),
      "user-1",
    );
    expect(body.session.scheduledStartAt).toBe(future);
    expect(body.session.calendarSync).toHaveLength(1);
  });
});
