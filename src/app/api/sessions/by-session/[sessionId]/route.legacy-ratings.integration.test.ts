/**
 * Route-level persistence tests for PATCH /api/sessions/by-session/[sessionId]
 * against a real in-process Postgres (PGlite) — legacy ratings.
 *
 * Issue #109 added the route for the post-session ratings (focus + happiness).
 * Issue #766 retired them: older builds still send `focusRating` /
 * `happinessRating`, and the route accepts them with any value, never writes
 * them, and answers a ratings-only save with the stored row (#891).
 *
 * Shared setup: `@/lib/testing/bySessionRouteHarness` (#1140).
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { getTestDb } from "@/lib/testing/pgliteTestDb";
import {
  actAsNobody,
  actAsOtherUser,
  get,
  LEGACY_RATINGS,
  MISSING_SESSION_ID,
  patch,
  patchRaw,
  storedLegacyRatings,
  storedMood,
  useBySessionFixture,
} from "@/lib/testing/bySessionRouteHarness";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

const fixture = useBySessionFixture();

describe("PATCH /api/sessions/by-session/[sessionId] — legacy ratings (#766)", () => {
  afterEach(() => {
    // Restores the db.update spy even when an assertion throws mid-test.
    vi.restoreAllMocks();
  });

  test("a ratings-only body returns 200 with the stored row and runs no UPDATE", async () => {
    const update = vi.spyOn(fixture.db, "update");

    const res = await patch({ focusRating: 7, happinessRating: 2 });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.id).toBe(fixture.sessionId);
    expect(json.session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(json.session.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
    expect(update).not.toHaveBeenCalled();
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test.each(["focusRating", "happinessRating"])("a body with only %s returns 200 and changes nothing", async (key) => {
    const res = await patch({ [key]: 7 });

    expect(res.status).toBe(200);
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test.each([0, 11, 1.5, -1, "great", null, { score: 7 }])(
    "accepts the invalid legacy value %j with 200, never 400, and changes nothing",
    async (value) => {
      const res = await patch({ focusRating: value, happinessRating: value });

      expect(res.status).toBe(200);
      expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
    },
  );

  test("legacy ratings beside a moodMatrix: the mood is saved and the ratings are ignored", async () => {
    const res = await patch({
      focusRating: 7,
      happinessRating: 2,
      moodMatrix: { overall: { before: 2, after: 5 } },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual({ overall: { before: 2, after: 5 } });
    expect(json.session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(json.session.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
    expect(await storedMood()).toEqual({ overall: { before: 2, after: 5 } });
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test("legacy ratings beside an invalid moodMatrix still fail with 400", async () => {
    const res = await patch({ focusRating: 7, moodMatrix: { calm: { before: 6, after: 3 } } });

    expect(res.status).toBe(400);
    expect(await storedMood()).toBeNull();
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test.each([{}, { foo: 1 }])("a body with no supported field (%j) fails with 400", async (body) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No supported fields provided");
  });

  test("another user's session returns 404 on a ratings-only body and persists nothing", async () => {
    actAsOtherUser();

    const res = await patch({ focusRating: 6, happinessRating: 6 });

    expect(res.status).toBe(404);
    expect(await storedLegacyRatings()).toEqual(LEGACY_RATINGS);
  });

  test("a ratings-only body for a session that does not exist returns 404", async () => {
    const res = await patch({ focusRating: 6 }, MISSING_SESSION_ID);

    expect(res.status).toBe(404);
  });

  test("invalid session id returns 400", async () => {
    const res = await patch({ focusRating: 5 }, "not-a-uuid");

    expect(res.status).toBe(400);
  });

  test("unauthenticated request returns 401", async () => {
    actAsNobody();

    const res = await patch({ focusRating: 5 });

    expect(res.status).toBe(401);
  });

  test("invalid JSON returns 400", async () => {
    const res = await patchRaw('{"focusRating": 5');

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  test.each([
    { name: "an array", body: [{ focusRating: 5 }] },
    { name: "null", body: null },
  ])("a non-object body ($name) returns 400", async ({ body }) => {
    const res = await patch(body);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Request body must be a JSON object");
  });

  test("GET by-session still returns the stored legacy ratings", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(session.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
  });
});
