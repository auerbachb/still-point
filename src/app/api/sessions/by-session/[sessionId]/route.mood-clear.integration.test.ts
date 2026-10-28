/**
 * Route-level persistence tests for PATCH /api/sessions/by-session/[sessionId]
 * against a real in-process Postgres (PGlite) — clearing a saved mood (#792).
 *
 * `moodMatrix: null` is what both clients send once every cell is deselected;
 * an all-null row is how they drop one row while keeping the rest.
 *
 * Shared setup: `@/lib/testing/bySessionRouteHarness` (#1140).
 */
import { describe, expect, test, vi } from "vitest";
import { getTestDb } from "@/lib/testing/pgliteTestDb";
import {
  actAsOtherUser,
  LEGACY_RATINGS,
  patch,
  seedMood,
  storedMood,
  storedRow,
  useBySessionFixture,
} from "@/lib/testing/bySessionRouteHarness";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

useBySessionFixture();

describe("PATCH /api/sessions/by-session/[sessionId] — mood matrix clear (#792)", () => {
  test("moodMatrix: null clears the stored matrix", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const res = await patch({ moodMatrix: null });

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toBeNull();
    expect(await storedMood()).toBeNull();
  });

  test("moodMatrix: null on a session with no mood succeeds and stores null", async () => {
    const res = await patch({ moodMatrix: null });

    expect(res.status).toBe(200);
    expect(await storedMood()).toBeNull();
  });

  test("an all-null row deletes only that row", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const res = await patch({ moodMatrix: { calm: { before: null, after: null } } });

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

    const res = await patch({ moodMatrix: { happiness: { before: null, after: null } } });

    const remaining = { calm: { before: 2, after: 4 }, overall: { before: 1, after: 2 } };
    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toEqual(remaining);
    expect(await storedMood()).toEqual(remaining);
  });

  test("an all-null row can ride along with an edited row", async () => {
    await seedMood({ calm: { before: 2, after: 4 }, focus: { before: 3, after: 5 } });

    const res = await patch({
      moodMatrix: { calm: { before: null, after: null }, focus: { before: 1, after: null } },
    });

    expect(res.status).toBe(200);
    expect(await storedMood()).toEqual({ focus: { before: 1, after: null } });
  });

  test("deleting the last row stores null rather than an empty object", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });

    const res = await patch({ moodMatrix: { calm: { before: null, after: null } } });

    expect(res.status).toBe(200);
    expect((await res.json()).session.moodMatrix).toBeNull();
    expect(await storedMood()).toBeNull();
  });

  test("an all-null row for a row that was never stored is a no-op", async () => {
    await seedMood({ focus: { before: 3, after: 5 } });

    const res = await patch({ moodMatrix: { energy: { before: null, after: null } } });

    expect(res.status).toBe(200);
    expect(await storedMood()).toEqual({ focus: { before: 3, after: 5 } });
  });

  test("a mood clear leaves ratings untouched and can share the PATCH with them", async () => {
    await patch({ focusRating: 6, moodMatrix: { calm: { before: 2, after: 4 } } });

    const res = await patch({ happinessRating: 8, moodMatrix: null });

    expect(res.status).toBe(200);
    const row = await storedRow();
    expect(row.moodMatrix).toBeNull();
    expect(row.focusRating).toBe(LEGACY_RATINGS.focusRating);
    expect(row.happinessRating).toBe(LEGACY_RATINGS.happinessRating);
  });

  test("an empty moodMatrix object still fails with 400 and clears nothing", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });

    const res = await patch({ moodMatrix: {} });

    expect(res.status).toBe(400);
    expect(await storedMood()).toEqual({ calm: { before: 2, after: 4 } });
  });

  test("a mood clear against another user's session returns 404 and clears nothing", async () => {
    await seedMood({ calm: { before: 2, after: 4 } });
    actAsOtherUser();

    const res = await patch({ moodMatrix: null });

    expect(res.status).toBe(404);
    expect(await storedMood()).toEqual({ calm: { before: 2, after: 4 } });
  });
});
