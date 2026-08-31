import { beforeEach, describe, expect, test, vi } from "vitest";

const limit = vi.fn();
const selectWhere = vi.fn(() => ({ limit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));

vi.mock("@/db", () => ({
  db: { select: dbSelect },
}));

vi.mock("@/db/schema", () => ({
  notificationPreferences: {
    userId: "userId",
    suppressDuringSession: "suppressDuringSession",
    sessionActiveUntil: "sessionActiveUntil",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

const now = new Date("2026-06-01T12:00:00.000Z");
const future = new Date("2026-06-01T12:02:00.000Z");
const past = new Date("2026-06-01T11:58:00.000Z");

describe("isSessionActive", () => {
  test("is active while the reported window has not expired", async () => {
    const { isSessionActive } = await import("./session-active");
    expect(isSessionActive(
      { suppressDuringSession: true, sessionActiveUntil: future },
      now,
    )).toBe(true);
  });

  test("expires on its own when a client stops reporting", async () => {
    const { isSessionActive } = await import("./session-active");
    expect(isSessionActive(
      { suppressDuringSession: true, sessionActiveUntil: past },
      now,
    )).toBe(false);
  });

  test("is inactive with no reported session", async () => {
    const { isSessionActive } = await import("./session-active");
    expect(isSessionActive(
      { suppressDuringSession: true, sessionActiveUntil: null },
      now,
    )).toBe(false);
  });

  test("opting out wins immediately, even with a live timestamp", async () => {
    const { isSessionActive } = await import("./session-active");
    expect(isSessionActive(
      { suppressDuringSession: false, sessionActiveUntil: future },
      now,
    )).toBe(false);
  });

  test("accepts an ISO string timestamp", async () => {
    const { isSessionActive } = await import("./session-active");
    expect(isSessionActive(
      { suppressDuringSession: true, sessionActiveUntil: future.toISOString() },
      now,
    )).toBe(true);
  });
});

describe("sessionActiveUntilFrom", () => {
  test("stores a TTL longer than the 60s client heartbeat", async () => {
    const { sessionActiveUntilFrom, SESSION_ACTIVE_TTL_MS } = await import("./session-active");
    expect(SESSION_ACTIVE_TTL_MS).toBeGreaterThan(60 * 1000);
    expect(sessionActiveUntilFrom(now).getTime()).toBe(now.getTime() + SESSION_ACTIVE_TTL_MS);
  });
});

describe("isUserSessionActive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("reads the recipient's row", async () => {
    limit.mockResolvedValue([{ suppressDuringSession: true, sessionActiveUntil: future }]);
    const { isUserSessionActive } = await import("./session-active");
    expect(await isUserSessionActive("user-1", now)).toBe(true);
  });

  test("fails open when the user has no preferences row", async () => {
    limit.mockResolvedValue([]);
    const { isUserSessionActive } = await import("./session-active");
    expect(await isUserSessionActive("user-1", now)).toBe(false);
  });
});
