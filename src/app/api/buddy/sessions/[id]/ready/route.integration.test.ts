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

import { PATCH } from "./route";

let db: TestDb;
let userId: string;
let hostUserId: string;
let buddySessionId: string;
let seq = 0;

function readyRequest(body: unknown, sessionId: string = buddySessionId) {
  return PATCH(
    new NextRequest(`http://test.local/api/buddy/sessions/${sessionId}/ready`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

async function seedLobbySession(state: "waiting" | "ready_check" = "ready_check") {
  seq += 1;
  const [host] = await db
    .insert(users)
    .values({ email: `host538-ready-${seq}@test.local`, username: `host538r_${seq}` })
    .returning({ id: users.id });
  const [guest] = await db
    .insert(users)
    .values({ email: `guest538-ready-${seq}@test.local`, username: `guest538r_${seq}`, currentDay: 3 })
    .returning({ id: users.id });
  hostUserId = host!.id;
  userId = guest!.id;

  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-ready-${seq}`,
      hostUserId,
      state,
      durationSeconds: 80,
      revision: 2,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: hostUserId, isHost: true, ready: true },
    { buddySessionId, userId, isHost: false, ready: false },
  ]);
}

beforeEach(async () => {
  db = await getTestDb();
  await seedLobbySession();
  getCurrentUser.mockResolvedValue({ userId, email: `guest538-ready-${seq}@test.local` });
});

afterAll(async () => {
  await closeTestDb();
});

describe("PATCH /api/buddy/sessions/[id]/ready", () => {
  test("sets ready=true and bumps revision in the lobby", async () => {
    const res = await readyRequest({ ready: true });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const [participant] = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.userId, userId));
    expect(participant!.ready).toBe(true);
    expect(participant!.lastSeenAt).not.toBeNull();

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.revision).toBe(3);
  });

  test("rejects invalid session id", async () => {
    const res = await readyRequest({ ready: true }, "not-a-uuid");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid session id" });
  });

  test("rejects non-boolean ready", async () => {
    const res = await readyRequest({ ready: "yes" });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "ready must be a boolean" });
  });

  test("rejects ready toggle after the lobby phase", async () => {
    await db
      .update(buddySessions)
      .set({ state: "active" })
      .where(eq(buddySessions.id, buddySessionId));

    const res = await readyRequest({ ready: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.READY_LOBBY_ONLY);
  });

  test("rejects callers who left the session", async () => {
    await db
      .update(buddySessionParticipants)
      .set({ leftAt: new Date() })
      .where(eq(buddySessionParticipants.userId, userId));

    const res = await readyRequest({ ready: true });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.NOT_IN_SESSION);
  });
});
