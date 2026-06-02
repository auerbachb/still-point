import { beforeEach, describe, expect, test, vi } from "vitest";

const getCurrentUser = vi.fn();
const listBuddyCalendarSessions = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser,
}));

vi.mock("@/lib/buddyCalendar", () => ({
  listBuddyCalendarSessions,
  parseBuddyCalendarRange: vi.fn(() => ({
    fromDate: "2025-03-01",
    toDate: "2025-05-29",
    limit: 200,
    offset: 0,
  })),
}));

describe("GET /api/buddy/sessions/calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ userId: "user-1", email: "a@b.com" });
    listBuddyCalendarSessions.mockResolvedValue({
      sessions: [],
      fromDate: "2025-03-01",
      toDate: "2025-05-29",
      hasMore: false,
    });
  });

  test("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://test/api/buddy/sessions/calendar"));
    expect(res.status).toBe(401);
  });

  test("returns calendar sessions for authenticated user", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://test/api/buddy/sessions/calendar"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
    expect(listBuddyCalendarSessions).toHaveBeenCalledWith("user-1", expect.any(Object));
  });
});
