import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buddySessionParticipants, buddySessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser, deleteRoom } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  deleteRoom: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/daily", () => ({ deleteRoom }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { POST } from "./route";

let db: TestDb;
let userId: string;
let hostUserId: string;
let buddySessionId: string;
let seq = 0;

function leaveRequest(sessionId: string = buddySessionId) {
  return POST(
    new NextRequest(`http://test.local/api/buddy/sessions/${sessionId}/leave`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

async function seedActiveSession(opts: { asHost: boolean; dailyRoomName?: string | null }) {
  seq += 1;
  const [host] = await db
    .insert(users)
    .values({ email: `host538-leave-${seq}@test.local`, username: `host538l_${seq}`, currentDay: 4 })
    .returning({ id: users.id });
  const [guest] = await db
    .insert(users)
    .values({ email: `guest538-leave-${seq}@test.local`, username: `guest538l_${seq}`, currentDay: 2 })
    .returning({ id: users.id });
  hostUserId = host!.id;
  userId = opts.asHost ? host!.id : guest!.id;

  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-leave-${seq}`,
      hostUserId,
      state: "active",
      durationSeconds: 70,
      startedAt: new Date(),
      dailyRoomName: opts.dailyRoomName ?? null,
      dailyRoomUrl: opts.dailyRoomName ? `https://daily.co/${opts.dailyRoomName}` : null,
      revision: 4,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: hostUserId, isHost: true, ready: true },
    { buddySessionId, userId: guest!.id, isHost: false, ready: true },
  ]);
}

beforeEach(async () => {
  db = await getTestDb();
  deleteRoom.mockResolvedValue(undefined);
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/buddy/sessions/[id]/leave", () => {
  test("non-host leave marks the participant row and keeps the session active", async () => {
    await seedActiveSession({ asHost: false });
    getCurrentUser.mockResolvedValue({ userId, email: `guest538-leave-${seq}@test.local` });

    const res = await leaveRequest();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const [participant] = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.userId, userId));
    expect(participant!.leftAt).not.toBeNull();
    expect(participant!.ready).toBe(false);

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("active");
    expect(session!.revision).toBe(5);
    expect(deleteRoom).not.toHaveBeenCalled();
  });

  test("host leave abandons the session and tears down the Daily room", async () => {
    await seedActiveSession({ asHost: true, dailyRoomName: "buddy-room-538" });
    getCurrentUser.mockResolvedValue({ userId: hostUserId, email: `host538-leave-${seq}@test.local` });

    const res = await leaveRequest();
    expect(res.status).toBe(200);

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("abandoned");
    expect(session!.dailyRoomName).toBeNull();
    expect(session!.dailyRoomUrl).toBeNull();
    expect(deleteRoom).toHaveBeenCalledWith("buddy-room-538", { ignoreMissing: true });
  });

  test("is a no-op when the participant already left", async () => {
    await seedActiveSession({ asHost: false });
    await db
      .update(buddySessionParticipants)
      .set({ leftAt: new Date(), ready: false })
      .where(eq(buddySessionParticipants.userId, userId));
    getCurrentUser.mockResolvedValue({ userId, email: `guest538-leave-${seq}@test.local` });

    const before = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));

    const res = await leaveRequest();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const after = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(after[0]!.revision).toBe(before[0]!.revision);
  });
});
