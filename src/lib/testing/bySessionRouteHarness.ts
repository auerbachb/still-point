import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { GET, PATCH } from "@/app/api/sessions/by-session/[sessionId]/route";
import { sessions, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { closeTestDb, getTestDb, type TestDb } from "./pgliteTestDb";

/**
 * Shared harness for the `route.*.integration.test.ts` files under
 * `src/app/api/sessions/by-session/[sessionId]/` (#1140).
 *
 * The suite is split by concern so a change to one PATCH path touches one file.
 * Every file still needs, at its top (a `vi.mock` only hoists in the test file):
 *
 * ```ts
 * vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
 * vi.mock("@/db", async () => ({ db: await getTestDb() }));
 * ```
 *
 * then calls `useBySessionFixture()` once at module scope, which registers the
 * hooks that seed two users and a fresh session before every test.
 */

/** #766: the legacy ratings every seeded session starts with. No test sends
 *  either value, so a PATCH that wrote one of the columns would show. */
export const LEGACY_RATINGS = { focusRating: 4, happinessRating: 9 } as const;

/** A well-formed session id no row ever has. */
export const MISSING_SESSION_ID = "6f1c2a4e-8b3d-4c5e-9f60-718293a4b5c6";

const OWNER_EMAIL = "ratings109@test.local";
const OTHER_EMAIL = "other109@test.local";

export type MoodMatrix = Record<string, { before: number | null; after: number | null }>;

type Fixture = {
  db: TestDb;
  userId: string;
  otherUserId: string;
  sessionId: string;
};

const fixture = {} as Fixture;

/** Register the per-file hooks and return the live fixture (filled in by them). */
export function useBySessionFixture(): Readonly<Fixture> {
  beforeAll(async () => {
    fixture.db = await getTestDb();

    const [user] = await fixture.db
      .insert(users)
      .values({ email: OWNER_EMAIL, username: "ratings109" })
      .returning({ id: users.id });
    const [other] = await fixture.db
      .insert(users)
      .values({ email: OTHER_EMAIL, username: "other109" })
      .returning({ id: users.id });
    fixture.userId = user!.id;
    fixture.otherUserId = other!.id;
  });

  beforeEach(async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ userId: fixture.userId, email: OWNER_EMAIL });

    const [session] = await fixture.db
      .insert(sessions)
      .values({
        userId: fixture.userId,
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
    fixture.sessionId = session!.id;
  });

  afterAll(async () => {
    await closeTestDb();
  });

  return fixture;
}

/** Sign the next requests in as the user who does not own the seeded session. */
export function actAsOtherUser(): void {
  vi.mocked(getCurrentUser).mockResolvedValue({ userId: fixture.otherUserId, email: OTHER_EMAIL });
}

/** Sign the next requests out. */
export function actAsNobody(): void {
  vi.mocked(getCurrentUser).mockResolvedValue(null);
}

function rawPatchRequest(sessionId: string, body: string): NextRequest {
  return new NextRequest(`http://test.local/api/sessions/by-session/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

/** PATCH a JSON body to the seeded session, or to `sessionId` when given. */
export function patch(body: unknown, sessionId: string = fixture.sessionId) {
  return patchRaw(JSON.stringify(body), sessionId);
}

/** PATCH an already-serialized (possibly malformed) body. */
export function patchRaw(body: string, sessionId: string = fixture.sessionId) {
  return PATCH(rawPatchRequest(sessionId, body), { params: Promise.resolve({ sessionId }) });
}

/** GET the seeded session. */
export function get(sessionId: string = fixture.sessionId) {
  return GET(
    new NextRequest(`http://test.local/api/sessions/by-session/${sessionId}`),
    { params: Promise.resolve({ sessionId }) },
  );
}

/** Store a mood matrix through the route, asserting the save succeeded. */
export async function seedMood(matrix: MoodMatrix): Promise<void> {
  const res = await patch({ moodMatrix: matrix });
  expect(res.status).toBe(200);
}

/** The seeded session's row as stored. */
export async function storedRow() {
  const [row] = await fixture.db.select().from(sessions).where(eq(sessions.id, fixture.sessionId));
  return row!;
}

export async function storedMood() {
  return (await storedRow()).moodMatrix;
}

export async function storedLegacyRatings() {
  const row = await storedRow();
  return { focusRating: row.focusRating, happinessRating: row.happinessRating };
}
