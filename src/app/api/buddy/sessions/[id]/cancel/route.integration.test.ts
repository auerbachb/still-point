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
let guestUserId: string;
let buddySessionId: string;
let seq = 0;

function cancelRequest(sessionId: string = buddySessionId) {
  return POST(
    new NextRequest(`http://test.local/api/buddy/sessions/${sessionId}/cancel`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
}

async function seedSession(
  state: "waiting" | "ready_check" | "active" | "completed",
  asHost: boolean,
) {
  seq += 1;
  const [host] = await db
    .insert(users)
    .values({ email: `host538-cancel-${seq}@test.local`, username: `host538c_${seq}` })
    .returning({ id: users.id });
  const [guest] = await db
    .insert(users)
    .values({ email: `guest538-cancel-${seq}@test.local`, username: `guest538c_${seq}` })
    .returning({ id: users.id });
  userId = asHost ? host!.id : guest!.id;
  guestUserId = guest!.id;

  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-cancel-${seq}`,
      hostUserId: host!.id,
      state,
      durationSeconds: 80,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: host!.id, isHost: true, ready: true },
    { buddySessionId, userId: guest!.id, isHost: false, ready: true },
  ]);
}

beforeEach(async () => {
  db = await getTestDb();
  await seedSession("ready_check", true);
  getCurrentUser.mockResolvedValue({ userId, email: `host538-cancel-${seq}@test.local` });
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/buddy/sessions/[id]/cancel", () => {
  test("host cancels a lobby session and marks it abandoned", async () => {
    const res = await cancelRequest();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    const [session] = await db
      .select()
      .from(buddySessions)
      .where(eq(buddySessions.id, buddySessionId));
    expect(session!.state).toBe("abandoned");
  });

  test("rejects cancel when the session is no longer in the lobby", async () => {
    await db
      .update(buddySessions)
      .set({ state: "active" })
      .where(eq(buddySessions.id, buddySessionId));

    const res = await cancelRequest();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.CANCEL_WRONG_PHASE);
  });

  test("rejects non-host callers", async () => {
    getCurrentUser.mockResolvedValue({ userId: guestUserId, email: `guest538-cancel-${seq}@test.local` });

    const res = await cancelRequest();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe(BUDDY_POLICY_CODES.HOST_ONLY);
  });
});
