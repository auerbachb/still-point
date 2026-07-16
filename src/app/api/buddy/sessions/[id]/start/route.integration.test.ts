import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buddySessionParticipants, buddySessions, users } from "@/db/schema";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser, createRoom, deleteRoom, DailyApiError, isDailyRoomNameConflict } = vi.hoisted(() => {
  class DailyApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown) {
      super(message);
      this.name = "DailyApiError";
      this.status = status;
      this.body = body;
    }
  }

  function isDailyRoomNameConflict(error: DailyApiError): boolean {
    if (error.status !== 400 && error.status !== 409) return false;
    const raw = `${error.message}\n${JSON.stringify(error.body)}`.toLowerCase();
    return (
      raw.includes("already") ||
      raw.includes("exists") ||
      raw.includes("taken") ||
      raw.includes("in use") ||
      raw.includes("duplicate")
    );
  }

  return {
    getCurrentUser: vi.fn(),
    createRoom: vi.fn(),
    deleteRoom: vi.fn(),
    DailyApiError,
    isDailyRoomNameConflict,
  };
});

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/daily", () => ({
  createRoom,
  deleteRoom,
  DailyApiError,
  isDailyRoomNameConflict,
}));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { POST } from "./route";

let db: TestDb;
let userId: string;
let guestUserId: string;
let buddySessionId: string;
let seq = 0;

function startRequest(sessionId: string = buddySessionId) {
  return POST(
    new NextRequest(`http://test.local/api/buddy/sessions/${sessionId}/start`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

async function seedReadyCheckSession(opts?: { scheduledStartAt?: Date | null }) {
  seq += 1;
  const [host] = await db
    .insert(users)
    .values({ email: `host538-start-${seq}@test.local`, username: `host538s_${seq}` })
    .returning({ id: users.id });
  const [guest] = await db
    .insert(users)
    .values({ email: `guest538-start-${seq}@test.local`, username: `guest538s_${seq}` })
    .returning({ id: users.id });
  userId = host!.id;
  guestUserId = guest!.id;

  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-start-${seq}`,
      hostUserId: userId,
      state: "ready_check",
      durationSeconds: 80,
      scheduledStartAt: opts?.scheduledStartAt ?? null,
      revision: 1,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId, isHost: true, ready: true },
    { buddySessionId, userId: guestUserId, isHost: false, ready: true },
  ]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await getTestDb();
  await seedReadyCheckSession();
  getCurrentUser.mockResolvedValue({ userId, email: `host538-start-${seq}@test.local` });
  createRoom.mockResolvedValue({
    name: `buddy-${buddySessionId}`,
    url: `https://daily.co/buddy-${buddySessionId}`,
  });
  deleteRoom.mockResolvedValue(undefined);
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/buddy/sessions/[id]/start", () => {
  test("host starts a ready_check session and provisions a Daily room", async () => {
    const res = await startRequest();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.startedAt).toBe("string");

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("active");
    expect(session!.dailyRoomName).toBe(`buddy-${buddySessionId}`);
    expect(session!.dailyRoomUrl).toBe(`https://daily.co/buddy-${buddySessionId}`);
    expect(session!.revision).toBe(2);
    expect(createRoom).toHaveBeenCalledWith({
      name: `buddy-${buddySessionId}`,
      privacy: "private",
    });
  });

  test("retries once after a Daily room name conflict", async () => {
    createRoom
      .mockRejectedValueOnce(new DailyApiError("Room already exists", 409, { info: "already taken" }))
      .mockResolvedValueOnce({
        name: `buddy-${buddySessionId}`,
        url: `https://daily.co/buddy-${buddySessionId}`,
      });

    const res = await startRequest();
    expect(res.status).toBe(200);

    expect(deleteRoom).toHaveBeenCalledWith(`buddy-${buddySessionId}`, { ignoreMissing: true });
    expect(createRoom).toHaveBeenCalledTimes(2);

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("active");
  });

  test("returns 503 when the retry after a name conflict also fails", async () => {
    createRoom
      .mockRejectedValueOnce(new DailyApiError("Room already exists", 409, { info: "already taken" }))
      .mockRejectedValueOnce(new DailyApiError("Still conflicted", 409, { info: "duplicate" }));

    const res = await startRequest();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("name conflict after cleanup");

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("ready_check");
  });

  test("returns 503 when DAILY_API_KEY is missing", async () => {
    createRoom.mockRejectedValueOnce(new Error("DAILY_API_KEY is not set. Add it to your environment"));

    const res = await startRequest();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("DAILY_API_KEY");

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("ready_check");
  });

  test("only one concurrent start wins; the loser tears down its room", async () => {
    const [first, second] = await Promise.all([startRequest(), startRequest()]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    const loser = first.status === 409 ? first : second;
    const loserBody = await loser.json();
    expect(loserBody.code).toBe(BUDDY_POLICY_CODES.START_WRONG_PHASE);
    expect(deleteRoom).toHaveBeenCalled();

    const winnerBody = await winner.json();
    expect(winnerBody.ok).toBe(true);

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("active");
  });

  test("rejects non-host callers", async () => {
    getCurrentUser.mockResolvedValue({ userId: guestUserId, email: `guest538-start-${seq}@test.local` });

    const res = await startRequest();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.HOST_ONLY);
    expect(createRoom).not.toHaveBeenCalled();
  });

  test("rejects start before ready_check phase", async () => {
    await db
      .update(buddySessions)
      .set({ state: "active", startedAt: new Date() })
      .where(eq(buddySessions.id, buddySessionId));

    const res = await startRequest();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.START_WRONG_PHASE);
  });

  test("rejects start before the scheduled time", async () => {
    await seedReadyCheckSession({
      scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    getCurrentUser.mockResolvedValue({ userId, email: `host538-start-${seq}@test.local` });

    const res = await startRequest();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "This session is scheduled for later.",
    });
  });
});
