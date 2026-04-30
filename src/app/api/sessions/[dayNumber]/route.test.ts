import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();

const sessionLimit = vi.fn();
const sessionWhere = vi.fn(() => ({ limit: sessionLimit }));
const sessionFrom = vi.fn(() => ({ where: sessionWhere }));

const thoughtsOrderBy = vi.fn();
const thoughtsWhere = vi.fn(() => ({ orderBy: thoughtsOrderBy }));
const thoughtsFrom = vi.fn(() => ({ where: thoughtsWhere }));

const select = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: select,
  },
}));

vi.mock("@/db/schema", () => ({
  sessions: { id: "id", userId: "userId", dayNumber: "dayNumber" },
  thoughts: {
    id: "id",
    sessionId: "sessionId",
    userId: "userId",
    dayNumber: "dayNumber",
    timeInSession: "timeInSession",
    text: "text",
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...c: unknown[]) => ({ and: c })),
  asc: vi.fn((c: unknown) => ({ asc: c })),
  eq: vi.fn((l: unknown, r: unknown) => ({ eq: [l, r] })),
}));

describe("GET /api/sessions/[dayNumber]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ userId: "user-1" });
    // First select() call: session lookup. Second: thoughts query.
    select.mockImplementation((projection?: Record<string, unknown>) => {
      if (!projection) {
        // session full select
        sessionLimit.mockResolvedValue([{ id: "session-1", userId: "user-1", dayNumber: 5 }]);
        return { from: sessionFrom };
      }
      // thoughts projection — assertion target
      thoughtsOrderBy.mockResolvedValue([
        {
          id: "thought-1",
          sessionId: "session-1",
          dayNumber: 5,
          timeInSession: 10,
          text: "noted",
        },
      ]);
      // Stash projection for assertion
      (select as unknown as { lastProjection: Record<string, unknown> }).lastProjection = projection;
      return { from: thoughtsFrom };
    });
  });

  test("includes sessionId in the thoughts projection (iOS ThoughtDTO contract)", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://test.local/api/sessions/5") as NextRequest,
      { params: Promise.resolve({ dayNumber: "5" }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.thoughts).toHaveLength(1);
    expect(body.thoughts[0]).toMatchObject({
      id: "thought-1",
      sessionId: "session-1",
      dayNumber: 5,
      timeInSession: 10,
      text: "noted",
    });
    // The five-field projection contract iOS depends on. Drop sessionId here and iOS decode regresses.
    const projection = (select as unknown as { lastProjection: Record<string, unknown> }).lastProjection;
    expect(Object.keys(projection).sort()).toEqual(["dayNumber", "id", "sessionId", "text", "timeInSession"]);
  });
});
