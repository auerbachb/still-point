/**
 * Issue #109 — post-session survey (focus + happiness).
 *
 * Route-level persistence tests for PATCH /api/sessions/by-session/[sessionId]
 * against a real in-process Postgres (PGlite), mirroring the pattern used for
 * POST /api/thoughts/batch (another post-hoc CompletionScreen add).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { PATCH } from "./route";

let db: TestDb;
let userId: string;
let otherUserId: string;
let sessionId: string;

function patchRequest(sessionId: string, body: unknown): NextRequest {
  return new NextRequest(`http://test.local/api/sessions/by-session/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function seedMood(matrix: Record<string, { before: number | null; after: number | null }>) {
  const res = await PATCH(
    patchRequest(sessionId, { moodMatrix: matrix }),
    { params: Promise.resolve({ sessionId }) },
  );
  expect(res.status).toBe(200);
}

async function storedMood() {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  return row!.moodMatrix;
}

beforeAll(async () => {
  db = await getTestDb();

  const [user] = await db
    .insert(users)
    .values({ email: "ratings109@test.local", username: "ratings109" })
    .returning({ id: users.id });
  const [other] = await db
    .insert(users)
    .values({ email: "other109@test.local", username: "other109" })
    .returning({ id: users.id });
  userId = user!.id;
  otherUserId = other!.id;
});

beforeEach(async () => {
  getCurrentUser.mockResolvedValue({ userId, email: "ratings109@test.local" });

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      dayNumber: 3,
      sessionType: "standard",
      duration: 80,
      completed: true,
      actualTime: 80,
      clearPercent: 74,
      thoughtCount: 0,
      mindStateLog: [],
      sessionDate: "2026-06-11",
    })
    .returning({ id: sessions.id });
  sessionId = session!.id;
});

afterAll(async () => {
  await closeTestDb();
});

describe("PATCH /api/sessions/by-session/[sessionId] — ratings", () => {
  test("sets both focusRating and happinessRating", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 7, happinessRating: 9 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.focusRating).toBe(7);
    expect(json.session.happinessRating).toBe(9);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row!.focusRating).toBe(7);
    expect(row!.happinessRating).toBe(9);
  });

  test("sets a single rating, leaving the other null", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 4 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.focusRating).toBe(4);
    expect(json.session.happinessRating).toBeNull();
  });

  test("a later PATCH overwrites a prior rating (revisable)", async () => {
    await PATCH(
      patchRequest(sessionId, { focusRating: 2, happinessRating: 2 }),
      { params: Promise.resolve({ sessionId }) },
    );
    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 8 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.focusRating).toBe(8);
    expect(json.session.happinessRating).toBe(2);
  });

  test.each([0, 11, 1.5, -1])("rejects out-of-range/non-integer rating %s with 400", async (value) => {
    const res = await PATCH(
      patchRequest(sessionId, { focusRating: value }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row!.focusRating).toBeNull();
  });

  test("rejects non-numeric rating with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { focusRating: "great" }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
  });

  test("empty body (no supported fields) fails visibly with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, {}),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No supported ratings provided");
  });

  test("invalid session id returns 400", async () => {
    const res = await PATCH(
      patchRequest("not-a-uuid", { focusRating: 5 }),
      { params: Promise.resolve({ sessionId: "not-a-uuid" }) },
    );

    expect(res.status).toBe(400);
  });

  test("another user's session id returns 404 and persists nothing", async () => {
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other109@test.local" });

    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 6, happinessRating: 6 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(404);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row!.focusRating).toBeNull();
    expect(row!.happinessRating).toBeNull();
  });

  test("unauthenticated request returns 401", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 5 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/sessions/by-session/[sessionId] — mood matrix (#472)", () => {
  test("saves a full mood matrix and returns it in the session", async () => {
    const matrix = {
      calm:    { before: 2, after: 4 },
      focus:   { before: 3, after: 5 },
      energy:  { before: 1, after: 3 },
      anxiety: { before: 4, after: 2 },
      overall: { before: 3, after: 5 },
    };

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: matrix }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual(matrix);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row!.moodMatrix).toEqual(matrix);
  });

  test("saves a partial mood matrix (subset of mood keys)", async () => {
    const matrix = { calm: { before: 3, after: null } };

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: matrix }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual(matrix);
  });

  test("can combine moodMatrix and ratings in a single PATCH", async () => {
    const res = await PATCH(
      patchRequest(sessionId, {
        focusRating: 7,
        moodMatrix: { overall: { before: 2, after: 5 } },
      }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.focusRating).toBe(7);
    expect(json.session.moodMatrix).toEqual({ overall: { before: 2, after: 5 } });
  });

  test("rejects an unknown mood key with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { mood_unknown: { before: 3, after: 4 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown mood key/);
  });

  test("rejects a mood value outside 1–5 with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: 6, after: 3 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
  });

  test("rejects a mood value of 0 with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: 0, after: 3 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
  });

  test("rejects a non-integer mood value with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: 2.5, after: 3 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
  });

  test("rejects a mood entry missing the after key with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: 3 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
  });

  test("rejects an empty moodMatrix object with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: {} }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("moodMatrix must have at least one mood entry");
  });

  test("rejects moodMatrix that is not an object with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: [{ calm: 3 }] }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
  });

  test("a later PATCH merges with the stored moodMatrix", async () => {
    await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: 1, after: 2 } } }),
      { params: Promise.resolve({ sessionId }) },
    );
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { focus: { before: 4, after: 5 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual({
      calm: { before: 1, after: 2 },
      focus: { before: 4, after: 5 },
    });
  });
});

/**
 * Issue #792 — clearing a saved mood. `moodMatrix: null` is what both clients
 * send once every cell is deselected; an all-null row is how they drop one row
 * while keeping the rest.
 */
describe("PATCH /api/sessions/by-session/[sessionId] — mood matrix clear (#792)", () => {
  test("moodMatrix: null clears the stored matrix", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: null }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toBeNull();
    expect(await storedMood()).toBeNull();
  });

  test("moodMatrix: null on a session with no mood succeeds and stores null", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: null }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect(await storedMood()).toBeNull();
  });

  test("an all-null row deletes only that row", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: null, after: null } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toEqual({ focus: { before: 3, after: 5 } });
    expect(await storedMood()).toEqual({ focus: { before: 3, after: 5 } });
  });

  test("an all-null row can ride along with an edited row", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const res = await PATCH(
      patchRequest(sessionId, {
        moodMatrix: { calm: { before: null, after: null }, focus: { before: 1, after: null } },
      }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect(await storedMood()).toEqual({ focus: { before: 1, after: null } });
  });

  test("deleting the last row stores null rather than an empty object", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { calm: { before: null, after: null } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toBeNull();
    expect(await storedMood()).toBeNull();
  });

  test("an all-null row for a row that was never stored is a no-op", async () => {
    await seedMood({ focus: { before: 3, after: 5 } });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { energy: { before: null, after: null } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect(await storedMood()).toEqual({ focus: { before: 3, after: 5 } });
  });

  test("a mood clear leaves ratings untouched and can share the PATCH with them", async () => {
    await PATCH(
      patchRequest(sessionId, { focusRating: 6, moodMatrix: { calm: { before: 2, after: 4 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    const res = await PATCH(
      patchRequest(sessionId, { happinessRating: 8, moodMatrix: null }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row!.moodMatrix).toBeNull();
    expect(row!.focusRating).toBe(6);
    expect(row!.happinessRating).toBe(8);
  });

  test("an empty moodMatrix object still fails with 400 and clears nothing", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: {} }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect(await storedMood()).toEqual({ calm: { before: 2, after: 4 } });
  });

  test("a mood clear against another user's session returns 404 and clears nothing", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other109@test.local" });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: null }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(404);
    expect(await storedMood()).toEqual({ calm: { before: 2, after: 4 } });
  });
});

/**
 * Issue #834 — the merge reads the stored matrix in the UPDATE itself, so two
 * PATCHes that overlap can no longer both merge from one earlier snapshot.
 * PGlite runs one statement at a time, but overlapping handlers still
 * interleave the way the old read-then-write lost rows: every read ran before
 * any write.
 */
describe("PATCH /api/sessions/by-session/[sessionId] — overlapping mood writes (#834)", () => {
  function patchMood(matrix: Record<string, { before: number | null; after: number | null }>) {
    return PATCH(
      patchRequest(sessionId, { moodMatrix: matrix }),
      { params: Promise.resolve({ sessionId }) },
    );
  }

  test("overlapping PATCHes each keep their row", async () => {
    const rows = {
      calm:    { before: 2, after: 4 },
      focus:   { before: 3, after: 5 },
      energy:  { before: 1, after: 3 },
      anxiety: { before: 4, after: 2 },
      overall: { before: 3, after: 5 },
    };

    const responses = await Promise.all(
      Object.entries(rows).map(([key, row]) => patchMood({ [key]: row })),
    );

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await storedMood()).toEqual(rows);
  });

  test("a row delete overlapping a row set: the deleted row stays gone and the new row lands", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const responses = await Promise.all([
      patchMood({ calm: { before: null, after: null } }),
      patchMood({ energy: { before: 1, after: 3 } }),
    ]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(await storedMood()).toEqual({
      focus: { before: 3, after: 5 },
      energy: { before: 1, after: 3 },
    });
  });

  test("a mood write to a session that does not exist returns 404", async () => {
    const missingId = "6f1c2a4e-8b3d-4c5e-9f60-718293a4b5c6";

    const res = await PATCH(
      patchRequest(missingId, { moodMatrix: { calm: { before: 2, after: 4 } } }),
      { params: Promise.resolve({ sessionId: missingId }) },
    );

    expect(res.status).toBe(404);
  });

  test("a mood write against another user's session returns 404 and changes nothing", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other109@test.local" });

    const res = await patchMood({
      calm: { before: null, after: null },
      focus: { before: 1, after: 1 },
    });

    expect(res.status).toBe(404);
    expect(await storedMood()).toEqual({ calm: { before: 2, after: 4 } });
  });
});
