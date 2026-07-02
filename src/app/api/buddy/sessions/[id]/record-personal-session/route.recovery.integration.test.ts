/**
 * Issue #238 — miss-a-day recovery: a completed shared (buddy) sit advances the
 * recovery ramp the same way a solo standard sit does, instead of always bumping
 * `currentDay`. Route-level test against a real in-process Postgres (PGlite).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { buddySessionParticipants, buddySessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/daily", () => ({ deleteRoom: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { POST } from "./route";

let db: TestDb;
let seq = 0;

function recordRequest(sessionId: string, rawBody: string) {
  const request = new NextRequest(
    `http://test.local/api/buddy/sessions/${sessionId}/record-personal-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    },
  );
  return POST(request, { params: Promise.resolve({ id: sessionId }) });
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/buddy/.../record-personal-session — miss-a-day recovery (#238)", () => {
  test("a completed shared sit mid-recovery steps the ramp instead of bumping currentDay", async () => {
    seq += 1;
    const [host] = await db.insert(users).values({ email: `bhost238-${seq}@test.local`, username: `bhost238_${seq}` }).returning({ id: users.id });
    const [buddy] = await db.insert(users).values({
      email: `bbuddy238-${seq}@test.local`,
      username: `bbuddy238_${seq}`,
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    }).returning({ id: users.id });

    const [buddySession] = await db.insert(buddySessions).values({
      shareToken: `tok-238-${seq}`,
      hostUserId: host!.id,
      state: "completed",
      durationSeconds: 60,
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
    }).returning({ id: buddySessions.id });

    await db.insert(buddySessionParticipants).values([
      { buddySessionId: buddySession!.id, userId: host!.id, isHost: true, ready: true },
      { buddySessionId: buddySession!.id, userId: buddy!.id, isHost: false, ready: true },
    ]);

    getCurrentUser.mockResolvedValue({ userId: buddy!.id, email: `bbuddy238-${seq}@test.local` });

    const res = await recordRequest(
      buddySession!.id,
      `{"clearPercent":80,"thoughtCount":0,"mindStateLog":[],"actualTime":60,"sessionDate":"2026-06-11"}`,
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, buddy!.id));
    expect(row!.currentDay).toBe(11);
    expect(row!.recoveryTargetDay).toBe(11);
    expect(row!.recoveryCurrentStep).toBe(3);
    expect(row!.recoveryTotalSteps).toBe(5);
  });
});
