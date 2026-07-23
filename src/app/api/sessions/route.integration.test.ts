/**
 * Issue #612 — GET /api/sessions projection contract.
 *
 * Route-level integration test against a real in-process Postgres (PGlite),
 * mirroring the pattern used for the by-session ratings route. Guards that the
 * history list returns exactly the columns SessionDTO consumes and never leaks
 * userId / clientSessionId / focus & happiness ratings.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { GET } from "./route";

let db: TestDb;
let userId: string;

/** The exact fields GET /api/sessions is allowed to expose (SessionDTO's shape). */
const EXPECTED_SESSION_KEYS = [
  "id", "dayNumber", "sessionType", "duration", "bonusSeconds", "completed",
  "actualTime", "clearPercent", "thoughtCount", "mindStateLog", "attentionLog",
  "sessionDate", "createdAt", "buddySessionId", "breathCount", "track", "ambientSoundSummary",
].sort();

/** Columns that must never reach the client from the history list. */
const LEAKED_KEYS = ["userId", "clientSessionId", "focusRating", "happinessRating", "moodMatrix"] as const;

/** Keys the iOS StatsDTO decodes; the stats object must carry all of them. */
const REQUIRED_STATS_KEYS = [
  "streak", "avgClearPercent", "avgThoughtsPerSession", "avgThoughtsPerMinute",
  "bonusMinutesTotal", "trailing4WeekDays", "trailing4WeekDayPercent",
  "trailing4WeekTotalTime", "trailing4WeekTimePercent", "totalTimeAllTime",
  "progressTo10kHours", "mindStateTrends",
];

function getRequest(today = "2026-06-12"): NextRequest {
  return new NextRequest(`http://test.local/api/sessions?today=${today}`);
}

async function seedSession() {
  await db.insert(sessions).values({
    userId,
    clientSessionId: "11111111-1111-1111-1111-111111111111",
    dayNumber: 3,
    sessionType: "breath",
    track: "second",
    duration: 180,
    bonusSeconds: 60,
    completed: true,
    actualTime: 200,
    clearPercent: 74,
    thoughtCount: 2,
    breathCount: 24,
    mindStateLog: [{ time: 0, state: "clear" }],
    attentionLog: [{ time: 0, state: "attentive" }],
    ambientSoundSummary: { avgDb: -42.5, peakDb: -12, quietPercent: 80, loudPercent: 20, sampleCount: 120 },
    sessionDate: "2026-06-11",
    // Set the PII / by-session-only columns so we can prove the projection drops them.
    focusRating: 7,
    happinessRating: 9,
    moodMatrix: { calm: { before: 2, after: 4 } },
  });
}

beforeAll(async () => {
  db = await getTestDb();
  const [user] = await db
    .insert(users)
    .values({ email: "hist612@test.local", username: "hist612" })
    .returning({ id: users.id });
  userId = user!.id;
});

beforeEach(async () => {
  getCurrentUser.mockResolvedValue({ userId, email: "hist612@test.local" });
  await db.delete(sessions);
});

afterAll(async () => {
  await closeTestDb();
});

describe("GET /api/sessions — projection contract (#612)", () => {
  test("returns exactly the SessionDTO columns and leaks none", async () => {
    await seedSession();

    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.sessions).toHaveLength(1);

    const session = body.sessions[0];
    expect(Object.keys(session).sort()).toEqual(EXPECTED_SESSION_KEYS);
    for (const key of LEAKED_KEYS) {
      expect(session).not.toHaveProperty(key);
    }
  });

  test("preserves the values SessionDTO relies on", async () => {
    await seedSession();

    const body = await (await GET(getRequest())).json();
    const session = body.sessions[0];

    expect(session.sessionType).toBe("breath");
    expect(session.track).toBe("second");
    expect(session.clearPercent).toBe(74);
    expect(session.breathCount).toBe(24);
    expect(session.ambientSoundSummary.sampleCount).toBe(120);
    expect(session.mindStateLog).toEqual([{ time: 0, state: "clear" }]);
  });

  test("returns the stats object the iOS StatsDTO consumes", async () => {
    await seedSession();

    const body = await (await GET(getRequest())).json();
    expect(Object.keys(body.stats)).toEqual(expect.arrayContaining(REQUIRED_STATS_KEYS));
  });

  test("returns an empty list (no throw) when the user has no sessions", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
    expect(Object.keys(body.stats)).toEqual(expect.arrayContaining(REQUIRED_STATS_KEYS));
  });

  test("returns 401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValueOnce(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });
});
