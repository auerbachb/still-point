/**
 * Issue #343 — "most meditated with buddy": route-level test for
 * GET /api/friends against a real in-process Postgres (PGlite), verifying
 * the sessions <-> buddy_session_participants join computes per-friend
 * sessionCount + totalDurationSeconds correctly and sorts by them.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  buddySessionParticipants,
  buddySessions,
  friendships,
  sessions,
  users,
} from "@/db/schema";
import { orderedUserPair } from "@/lib/friends";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { GET } from "./route";

let db: TestDb;
let seq = 0;

async function createUser(prefix: string) {
  seq += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `${prefix}${seq}@test.local`, username: `${prefix}${seq}` })
    .returning({ id: users.id });
  return row!.id;
}

async function befriend(a: string, b: string) {
  const [user1Id, user2Id] = orderedUserPair(a, b);
  await db.insert(friendships).values({ user1Id, user2Id });
}

/** Creates a completed shared buddy sit between `hostId` and `buddyId`, with
 * each participant's own `sessions` row (mirrors record-personal-session). */
async function createSharedSit(
  hostId: string,
  buddyId: string,
  opts: { durationSeconds: number; hostActualTime?: number; buddyActualTime?: number },
) {
  seq += 1;
  const [bs] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-${seq}`,
      hostUserId: hostId,
      state: "completed",
      durationSeconds: opts.durationSeconds,
    })
    .returning({ id: buddySessions.id });
  const buddySessionId = bs!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: hostId, isHost: true, ready: true },
    { buddySessionId, userId: buddyId, isHost: false, ready: true },
  ]);

  await db.insert(sessions).values([
    {
      userId: hostId,
      buddySessionId,
      dayNumber: 1,
      duration: opts.durationSeconds,
      actualTime: opts.hostActualTime ?? opts.durationSeconds,
      completed: true,
      clearPercent: 100,
      sessionDate: "2026-01-01",
    },
    {
      userId: buddyId,
      buddySessionId,
      dayNumber: 1,
      duration: opts.durationSeconds,
      actualTime: opts.buddyActualTime ?? opts.durationSeconds,
      completed: true,
      clearPercent: 100,
      sessionDate: "2026-01-01",
    },
  ]);

  return buddySessionId;
}

beforeEach(async () => {
  db = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

describe("GET /api/friends — most meditated with buddy (#343)", () => {
  test("returns sessionCount + totalDurationSeconds per friend, sorted by most sat together", async () => {
    const me = await createUser("me");
    const alice = await createUser("alice");
    const bob = await createUser("bob");
    await befriend(me, alice);
    await befriend(me, bob);

    // Two shared sits with alice (600s each, actualTime 600 for `me`).
    await createSharedSit(me, alice, { durationSeconds: 600 });
    await createSharedSit(me, alice, { durationSeconds: 600 });
    // One shared sit with bob (300s).
    await createSharedSit(me, bob, { durationSeconds: 300 });

    getCurrentUser.mockResolvedValue({ userId: me, email: "me@test.local" });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.friends).toEqual([
      { id: alice, username: expect.stringContaining("alice"), sessionCount: 2, totalDurationSeconds: 1200 },
      { id: bob, username: expect.stringContaining("bob"), sessionCount: 1, totalDurationSeconds: 300 },
    ]);
  });

  test("friends with no shared sessions report zero stats", async () => {
    const me = await createUser("me");
    const carol = await createUser("carol");
    await befriend(me, carol);

    getCurrentUser.mockResolvedValue({ userId: me, email: "me@test.local" });
    const res = await GET();
    const json = await res.json();

    expect(json.friends).toEqual([
      { id: carol, username: expect.stringContaining("carol"), sessionCount: 0, totalDurationSeconds: 0 },
    ]);
  });

  test("uses actualTime over nominal duration, and only counts the current user's own session rows", async () => {
    const me = await createUser("me");
    const dave = await createUser("dave");
    await befriend(me, dave);

    // `me` sat 90s of a scheduled 120s sit; dave's own actualTime shouldn't count toward `me`'s total.
    await createSharedSit(me, dave, { durationSeconds: 120, hostActualTime: 90, buddyActualTime: 120 });

    getCurrentUser.mockResolvedValue({ userId: me, email: "me@test.local" });
    const res = await GET();
    const json = await res.json();

    expect(json.friends).toEqual([
      { id: dave, username: expect.stringContaining("dave"), sessionCount: 1, totalDurationSeconds: 90 },
    ]);
  });

  test("uncompleted buddy sits are excluded from the stats", async () => {
    const me = await createUser("me");
    const erin = await createUser("erin");
    await befriend(me, erin);

    const completedSitId = await createSharedSit(me, erin, { durationSeconds: 300 });
    const abandonedSitId = await createSharedSit(me, erin, { durationSeconds: 600 });
    // Simulate an abandoned sit: `me`'s personal session row was never marked completed.
    await db
      .update(sessions)
      .set({ completed: false })
      .where(and(eq(sessions.buddySessionId, abandonedSitId), eq(sessions.userId, me)));
    void completedSitId;

    getCurrentUser.mockResolvedValue({ userId: me, email: "me@test.local" });
    const res = await GET();
    const json = await res.json();
    expect(json.friends).toEqual([
      { id: erin, username: expect.stringContaining("erin"), sessionCount: 1, totalDurationSeconds: 300 },
    ]);
  });

  test("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
