/**
 * Route-level persistence tests for PATCH /api/sessions/by-session/[sessionId]
 * against a real in-process Postgres (PGlite), mirroring the pattern used for
 * POST /api/thoughts/batch (another post-hoc CompletionScreen add).
 *
 * Issue #109 added the route for the post-session ratings (focus + happiness).
 * Issue #766 retired them: the route now ignores those fields, and the legacy
 * tests prove the stored values never change (#891).
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { GET, PATCH } from "./route";

/** #766: the legacy ratings every seeded session starts with. No test sends
 *  either value, so a PATCH that wrote one of the columns would show. */
const LEGACY_RATINGS = { focusRating: 4, happinessRating: 9 } as const;

let db: TestDb;
let userId: string;
let otherUserId: string;
let sessionId: string;

function patchRequest(sessionId: string, body: unknown): NextRequest {
  return rawPatchRequest(sessionId, JSON.stringify(body));
}

function rawPatchRequest(sessionId: string, body: string): NextRequest {
  return new NextRequest(`http://test.local/api/sessions/by-session/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
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

async function storedLegacyRatings() {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  return { focusRating: row!.focusRating, happinessRating: row!.happinessRating };
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
      ...LEGACY_RATINGS,
    })
    .returning({ id: sessions.id });
  sessionId = session!.id;
});

afterAll(async () => {
  await closeTestDb();
});

/**
 * Issue #766 — the session ratings are retired, but older builds still send
 * `focusRating` / `happinessRating`. The route accepts them with any value,
 * never writes them, and answers a ratings-only save with the stored row.
 */
describe("PATCH /api/sessions/by-session/[sessionId] — legacy ratings (#766)", () => {
  afterEach(() => {
    // Restores the db.update spy even when an assertion throws mid-test.
    vi.restoreAllMocks();
  });

  test("a ratings-only body returns 200 with the stored row and runs no UPDATE", async () => {
    const update = vi.spyOn(db, "update");

    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 7, happinessRating: 2 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.id).toBe(sessionId);
    expect(json.session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(json.session.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
    expect(update).not.toHaveBeenCalled();
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test.each(["focusRating", "happinessRating"])("a body with only %s returns 200 and changes nothing", async (key) => {
    const res = await PATCH(
      patchRequest(sessionId, { [key]: 7 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test.each([0, 11, 1.5, -1, "great", null, { score: 7 }])(
    "accepts the invalid legacy value %j with 200, never 400, and changes nothing",
    async (value) => {
      const res = await PATCH(
        patchRequest(sessionId, { focusRating: value, happinessRating: value }),
        { params: Promise.resolve({ sessionId }) },
      );

      expect(res.status).toBe(200);
      expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
    },
  );

  test("legacy ratings beside a moodMatrix: the mood is saved and the ratings are ignored", async () => {
    const res = await PATCH(
      patchRequest(sessionId, {
        focusRating: 7,
        happinessRating: 2,
        moodMatrix: { overall: { before: 2, after: 5 } },
      }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual({ overall: { before: 2, after: 5 } });
    expect(json.session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(json.session.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
    expect(await storedMood()).toEqual({ overall: { before: 2, after: 5 } });
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test("legacy ratings beside an invalid moodMatrix still fail with 400", async () => {
    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 7, moodMatrix: { calm: { before: 6, after: 3 } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect(await storedMood()).toBeNull();
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test.each([{}, { foo: 1 }])("a body with no supported field (%j) fails with 400", async (body) => {
    const res = await PATCH(
      patchRequest(sessionId, body),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No supported fields provided");
  });

  test("another user's session returns 404 on a ratings-only body and persists nothing", async () => {
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other109@test.local" });

    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 6, happinessRating: 6 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(404);
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test("a ratings-only body for a session that does not exist returns 404", async () => {
    const missingId = "6f1c2a4e-8b3d-4c5e-9f60-718293a4b5c6";

    const res = await PATCH(
      patchRequest(missingId, { focusRating: 6 }),
      { params: Promise.resolve({ sessionId: missingId }) },
    );

    expect(res.status).toBe(404);
  });

  test("invalid session id returns 400", async () => {
    const res = await PATCH(
      patchRequest("not-a-uuid", { focusRating: 5 }),
      { params: Promise.resolve({ sessionId: "not-a-uuid" }) },
    );

    expect(res.status).toBe(400);
  });

  test("unauthenticated request returns 401", async () => {
    getCurrentUser.mockResolvedValue(null);

    const res = await PATCH(
      patchRequest(sessionId, { focusRating: 5 }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(401);
  });

  test("invalid JSON returns 400", async () => {
    const res = await PATCH(
      rawPatchRequest(sessionId, '{"focusRating": 5'),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  test.each([
    { name: "an array", body: [{ focusRating: 5 }] },
    { name: "null", body: null },
  ])("a non-object body ($name) returns 400", async ({ body }) => {
    const res = await PATCH(
      patchRequest(sessionId, body),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Request body must be a JSON object");
  });

  test("GET by-session still returns the stored legacy ratings", async () => {
    const res = await GET(
      new NextRequest(`http://test.local/api/sessions/by-session/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(session.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
  });
});

describe("PATCH /api/sessions/by-session/[sessionId] — mood matrix (#472)", () => {
  test("saves a full mood matrix and returns it in the session", async () => {
    const matrix = {
      calm:      { before: 2, after: 4 },
      focus:     { before: 3, after: 5 },
      energy:    { before: 1, after: 3 },
      anxiety:   { before: 4, after: 2 },
      happiness: { before: 2, after: 5 },
      overall:   { before: 3, after: 5 },
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

  test("a moodMatrix PATCH can carry a legacy rating, which is ignored (#766)", async () => {
    const res = await PATCH(
      patchRequest(sessionId, {
        focusRating: 7,
        moodMatrix: { overall: { before: 2, after: 5 } },
      }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.focusRating).toBe(LEGACY_RATINGS.focusRating);
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

  // #885: `happiness` is accepted through MOOD_KEYS, with no route change.
  test.each([
    { before: 1, after: 5 },
    { before: null, after: 3 },
    { before: 4, after: null },
  ])("saves a happiness row %o and reads it back unchanged", async (happiness) => {
    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { happiness } }),
      { params: Promise.resolve({ sessionId }) },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toEqual({ happiness });

    const [row] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(row!.moodMatrix).toEqual({ happiness });

    const read = await GET(
      new NextRequest(`http://test.local/api/sessions/by-session/${sessionId}`),
      { params: Promise.resolve({ sessionId }) },
    );
    expect(read.status).toBe(200);
    expect((await read.json()).session.moodMatrix).toEqual({ happiness });
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

  test("an all-null happiness row deletes only that row (#885)", async () => {
    await seedMood({
      calm: { before: 2, after: 4 },
      happiness: { before: 3, after: 5 },
      overall: { before: 1, after: 2 },
    });

    const res = await PATCH(
      patchRequest(sessionId, { moodMatrix: { happiness: { before: null, after: null } } }),
      { params: Promise.resolve({ sessionId }) },
    );

    const remaining = { calm: { before: 2, after: 4 }, overall: { before: 1, after: 2 } };
    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toEqual(remaining);
    expect(await storedMood()).toEqual(remaining);
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
    expect(row!.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(row!.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
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
