import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buddySessionParticipants, buddySessions, users } from "@/db/schema";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/daily", () => ({ deleteRoom: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { POST } from "./route";

let db: TestDb;
let userId: string;
let hostUserId: string;
let buddySessionId: string;
let seq = 0;

function completeRequest(sessionId: string = buddySessionId) {
  return POST(
    new NextRequest(`http://test.local/api/buddy/sessions/${sessionId}/participant-complete`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

async function seedSession(state: "active" | "completed" | "waiting") {
  seq += 1;
  const [host] = await db
    .insert(users)
    .values({ email: `host538-pc-${seq}@test.local`, username: `host538pc_${seq}` })
    .returning({ id: users.id });
  const [guest] = await db
    .insert(users)
    .values({ email: `guest538-pc-${seq}@test.local`, username: `guest538pc_${seq}` })
    .returning({ id: users.id });
  hostUserId = host!.id;
  userId = guest!.id;

  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-pc-${seq}`,
      hostUserId,
      state,
      durationSeconds: 80,
      startedAt: state === "active" ? new Date() : null,
      revision: 1,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: hostUserId, isHost: true, ready: true },
    { buddySessionId, userId, isHost: false, ready: true },
  ]);
}

beforeEach(async () => {
  db = await getTestDb();
  await seedSession("active");
  getCurrentUser.mockResolvedValue({ userId, email: `guest538-pc-${seq}@test.local` });
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/buddy/sessions/[id]/participant-complete", () => {
  test("marks participant completion and bumps revision", async () => {
    const res = await completeRequest();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.participantCompletedAt).toBe("string");

    const [participant] = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.userId, userId));
    expect(participant!.participantCompletedAt).not.toBeNull();

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.revision).toBe(2);
  });

  test("repeat calls are idempotent with already=true", async () => {
    const first = await completeRequest();
    expect(first.status).toBe(200);
    const firstBody = await first.json();

    const second = await completeRequest();
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.already).toBe(true);
    expect(secondBody.participantCompletedAt).toBeUndefined();

    const [participant] = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.userId, userId));
    expect(participant!.participantCompletedAt!.toISOString()).toBe(firstBody.participantCompletedAt);
  });

  test("rejects completion before the shared sit is active", async () => {
    await db
      .update(buddySessions)
      .set({ state: "waiting" })
      .where(eq(buddySessions.id, buddySessionId));

    const res = await completeRequest();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.PARTICIPANT_COMPLETE_WRONG_PHASE);
  });

  test("rejects callers who are not in the session", async () => {
    const [stranger] = await db
      .insert(users)
      .values({ email: `stranger538-${seq}@test.local`, username: `stranger538_${seq}` })
      .returning({ id: users.id });
    getCurrentUser.mockResolvedValue({
      userId: stranger!.id,
      email: `stranger538-${seq}@test.local`,
    });

    const res = await completeRequest();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.NOT_IN_SESSION);
  });
});
