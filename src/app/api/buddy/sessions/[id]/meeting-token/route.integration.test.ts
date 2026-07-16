import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buddySessionParticipants, buddySessions, users } from "@/db/schema";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser, createMeetingToken, DailyApiError } = vi.hoisted(() => {
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

  return {
    getCurrentUser: vi.fn(),
    createMeetingToken: vi.fn(),
    DailyApiError,
  };
});

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/daily", () => ({
  createMeetingToken,
  DailyApiError,
}));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { POST } from "./route";

let db: TestDb;
let userId: string;
let hostUserId: string;
let buddySessionId: string;
let seq = 0;

function tokenRequest(sessionId: string = buddySessionId) {
  return POST(
    new NextRequest(`http://test.local/api/buddy/sessions/${sessionId}/meeting-token`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

async function seedActiveSession(opts?: { dailyRoomName?: string | null; left?: boolean }) {
  seq += 1;
  const [host] = await db
    .insert(users)
    .values({ email: `host538-token-${seq}@test.local`, username: `host538t_${seq}` })
    .returning({ id: users.id });
  const [guest] = await db
    .insert(users)
    .values({ email: `guest538-token-${seq}@test.local`, username: `guest538t_${seq}` })
    .returning({ id: users.id });
  hostUserId = host!.id;
  userId = guest!.id;

  const roomName = opts?.dailyRoomName === undefined ? `buddy-${seq}` : opts.dailyRoomName;
  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-token-${seq}`,
      hostUserId,
      state: "active",
      durationSeconds: 80,
      startedAt: new Date(),
      dailyRoomName: roomName,
      dailyRoomUrl: roomName ? `https://daily.co/${roomName}` : null,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: hostUserId, isHost: true, ready: true },
    {
      buddySessionId,
      userId,
      isHost: false,
      ready: true,
      leftAt: opts?.left ? new Date() : null,
    },
  ]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = await getTestDb();
  await seedActiveSession();
  getCurrentUser.mockResolvedValue({ userId, email: `guest538-token-${seq}@test.local` });
  createMeetingToken.mockResolvedValue("daily-meeting-token-abc");
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/buddy/sessions/[id]/meeting-token", () => {
  test("mints a token for an active participant", async () => {
    const res = await tokenRequest();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: "daily-meeting-token-abc" });

    expect(createMeetingToken).toHaveBeenCalledWith({
      roomName: `buddy-${seq}`,
      userName: `guest538t_${seq}`,
      userId,
    });
  });

  test("rejects callers who left the session", async () => {
    await db
      .update(buddySessionParticipants)
      .set({ leftAt: new Date() })
      .where(eq(buddySessionParticipants.userId, userId));

    const res = await tokenRequest();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.NOT_IN_SESSION);
    expect(createMeetingToken).not.toHaveBeenCalled();
  });

  test("rejects token requests when the session is not active", async () => {
    await db
      .update(buddySessions)
      .set({ state: "ready_check", dailyRoomName: null, dailyRoomUrl: null })
      .where(eq(buddySessions.id, buddySessionId));

    const res = await tokenRequest();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Video token is only available during an active buddy sit");
    expect(body.code).toBeUndefined();
  });

  test("returns 503 when Daily token minting fails", async () => {
    createMeetingToken.mockRejectedValue(new DailyApiError("Daily unavailable", 503, null));

    const res = await tokenRequest();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("Could not issue a video token. Check Daily configuration.");
  });
});
