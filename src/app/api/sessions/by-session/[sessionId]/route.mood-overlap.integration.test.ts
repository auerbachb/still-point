/**
 * Route-level persistence tests for PATCH /api/sessions/by-session/[sessionId]
 * against a real in-process Postgres (PGlite) — overlapping mood writes (#834).
 *
 * The merge reads the stored matrix in the UPDATE itself, so two PATCHes that
 * overlap can no longer both merge from one earlier snapshot. PGlite runs one
 * statement at a time, but overlapping handlers still interleave the way the
 * old read-then-write lost rows: every read ran before any write.
 *
 * Shared setup: `@/lib/testing/bySessionRouteHarness` (#1140).
 */
import { describe, expect, test, vi } from "vitest";
import { getTestDb } from "@/lib/testing/pgliteTestDb";
import {
  actAsOtherUser,
  MISSING_SESSION_ID,
  patch,
  seedMood,
  storedMood,
  useBySessionFixture,
  type MoodMatrix,
} from "@/lib/testing/bySessionRouteHarness";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

useBySessionFixture();

describe("PATCH /api/sessions/by-session/[sessionId] — overlapping mood writes (#834)", () => {
  function patchMood(matrix: MoodMatrix) {
    return patch({ moodMatrix: matrix });
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
    const res = await patch({ moodMatrix: { calm: { before: 2, after: 4 } } }, MISSING_SESSION_ID);

    expect(res.status).toBe(404);
  });

  test("a mood write against another user's session returns 404 and changes nothing", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });
    actAsOtherUser();

    const res = await patchMood({
      calm: { before: null, after: null },
      focus: { before: 1, after: 1 },
    });

    expect(res.status).toBe(404);
    expect(await storedMood()).toEqual({ calm: { before: 2, after: 4 } });
  });
});
