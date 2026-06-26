import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

// vi.mock factories are hoisted above module-level declarations, so the shared mock
// handles they reference are created in vi.hoisted (runs alongside the hoisted mocks).
const h = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const dbSelect = vi.fn(() => ({ from: selectFrom }));

  const insertReturning = vi.fn();
  const onConflictDoUpdate = vi.fn(() => ({ returning: insertReturning }));
  const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
  const dbInsert = vi.fn(() => ({ values: insertValues }));

  const getCurrentUser = vi.fn();

  return {
    selectLimit,
    dbSelect,
    insertReturning,
    onConflictDoUpdate,
    insertValues,
    dbInsert,
    getCurrentUser,
  };
});

const { getCurrentUser, selectLimit, insertReturning, onConflictDoUpdate, insertValues, dbInsert } = h;

vi.mock("@/db", () => ({
  db: {
    select: h.dbSelect,
    insert: h.dbInsert,
  },
}));

vi.mock("@/db/schema", () => ({
  failureReasons: {
    id: "id",
    userId: "userId",
    reasonDate: "reasonDate",
    text: "text",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: h.getCurrentUser }));

vi.mock("@/lib/readJsonObject", () => ({
  readJsonObject: async (request: Request) => ({ ok: true, body: await request.json() }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args) => ({ and: args })),
  eq: vi.fn((left, right) => ({ left, right })),
}));

const sampleRow = {
  id: "fr-1",
  userId: "user-1",
  reasonDate: "2026-05-28",
  text: "Too tired after work.",
  createdAt: new Date("2026-05-28T20:01:00.000Z"),
  updatedAt: new Date("2026-05-28T20:01:00.000Z"),
};

describe("/api/failure-reasons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "test@example.com" });
    selectLimit.mockResolvedValue([sampleRow]);
    insertReturning.mockResolvedValue([sampleRow]);
  });

  test("GET returns existence and the stored reason for a valid date", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/failure-reasons?date=2026-05-28") as NextRequest,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exists).toBe(true);
    expect(body.failureReason.text).toBe("Too tired after work.");
  });

  test("GET reports no reason when none is stored", async () => {
    selectLimit.mockResolvedValue([]);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/failure-reasons?date=2026-05-28") as NextRequest,
    );
    const body = await response.json();

    expect(body.exists).toBe(false);
    expect(body.failureReason).toBeNull();
  });

  test("GET rejects an invalid date", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/failure-reasons?date=not-a-date") as NextRequest,
    );
    expect(response.status).toBe(400);
  });

  test("GET returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/failure-reasons?date=2026-05-28") as NextRequest,
    );
    expect(response.status).toBe(401);
  });

  test("POST upserts a trimmed reason", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test.local/api/failure-reasons", {
        method: "POST",
        body: JSON.stringify({ reasonDate: "2026-05-28", text: "  Too tired after work.  " }),
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", reasonDate: "2026-05-28", text: "Too tired after work." }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ text: "Too tired after work." }) }),
    );
  });

  test("POST rejects empty text", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test.local/api/failure-reasons", {
        method: "POST",
        body: JSON.stringify({ reasonDate: "2026-05-28", text: "   " }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  test("POST rejects an invalid reasonDate", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test.local/api/failure-reasons", {
        method: "POST",
        body: JSON.stringify({ reasonDate: "2026-13-99", text: "valid" }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  test("POST rejects a future reasonDate", async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test.local/api/failure-reasons", {
        method: "POST",
        body: JSON.stringify({ reasonDate: future, text: "planning ahead" }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  test("POST rejects text over the length cap", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://test.local/api/failure-reasons", {
        method: "POST",
        body: JSON.stringify({ reasonDate: "2026-05-28", text: "x".repeat(1001) }),
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(dbInsert).not.toHaveBeenCalled();
  });
});
