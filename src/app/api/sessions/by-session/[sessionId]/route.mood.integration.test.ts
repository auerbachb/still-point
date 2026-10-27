/**
 * Route-level persistence tests for PATCH /api/sessions/by-session/[sessionId]
 * against a real in-process Postgres (PGlite) — saving and validating the
 * before/after mood matrix (#472), including the Happiness row (#885).
 *
 * Shared setup: `@/lib/testing/bySessionRouteHarness` (#1140).
 */
import { describe, expect, test, vi } from "vitest";
import { getTestDb } from "@/lib/testing/pgliteTestDb";
import {
  get,
  LEGACY_RATINGS,
  patch,
  storedMood,
  useBySessionFixture,
} from "@/lib/testing/bySessionRouteHarness";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

useBySessionFixture();

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

    const res = await patch({ moodMatrix: matrix });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual(matrix);
    expect(await storedMood()).toEqual(matrix);
  });

  test("saves a partial mood matrix (subset of mood keys)", async () => {
    const matrix = { calm: { before: 3, after: null } };

    const res = await patch({ moodMatrix: matrix });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.moodMatrix).toEqual(matrix);
  });

  test("a moodMatrix PATCH can carry a legacy rating, which is ignored (#766)", async () => {
    const res = await patch({
      focusRating: 7,
      moodMatrix: { overall: { before: 2, after: 5 } },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(json.session.moodMatrix).toEqual({ overall: { before: 2, after: 5 } });
  });

  test("rejects an unknown mood key with 400", async () => {
    const res = await patch({ moodMatrix: { mood_unknown: { before: 3, after: 4 } } });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown mood key/);
  });

  test("rejects a mood value outside 1–5 with 400", async () => {
    const res = await patch({ moodMatrix: { calm: { before: 6, after: 3 } } });

    expect(res.status).toBe(400);
  });

  test("rejects a mood value of 0 with 400", async () => {
    const res = await patch({ moodMatrix: { calm: { before: 0, after: 3 } } });

    expect(res.status).toBe(400);
  });

  test("rejects a non-integer mood value with 400", async () => {
    const res = await patch({ moodMatrix: { calm: { before: 2.5, after: 3 } } });

    expect(res.status).toBe(400);
  });

  test("rejects a mood entry missing the after key with 400", async () => {
    const res = await patch({ moodMatrix: { calm: { before: 3 } } });

    expect(res.status).toBe(400);
  });

  test("rejects an empty moodMatrix object with 400", async () => {
    const res = await patch({ moodMatrix: {} });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("moodMatrix must have at least one mood entry");
  });

  test("rejects moodMatrix that is not an object with 400", async () => {
    const res = await patch({ moodMatrix: [{ calm: 3 }] });

    expect(res.status).toBe(400);
  });

  test("a later PATCH merges with the stored moodMatrix", async () => {
    await patch({ moodMatrix: { calm: { before: 1, after: 2 } } });
    const res = await patch({ moodMatrix: { focus: { before: 4, after: 5 } } });

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
    const res = await patch({ moodMatrix: { happiness } });

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toEqual({ happiness });
    expect(await storedMood()).toEqual({ happiness });

    const read = await get();
    expect(read.status).toBe(200);
    expect((await read.json()).session.moodMatrix).toEqual({ happiness });
  });
});
