/**
 * Issue #240 — dual-track fork: a `second`-track completed standard sit advances
 * the independent `secondTrackDay` counter (only when the user has opted in) and
 * never touches the primary track's `currentDay`, while a `primary` sit keeps the
 * original progression. Route-level tests against a real in-process Postgres.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { POST } from "./route";

let db: TestDb;
let seq = 0;

function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  seq += 1;
  return db
    .insert(users)
    .values({ email: `dt240-${seq}@test.local`, username: `dt240_${seq}`, ...overrides })
    .returning()
    .then((rows) => rows[0]!);
}

function sessionRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test.local/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseSessionBody(overrides: Record<string, unknown> = {}) {
  return {
    dayNumber: 1,
    duration: 60,
    actualTime: 60,
    clearPercent: 90,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate: "2026-06-11",
    completed: true,
    sessionType: "standard",
    ...overrides,
  };
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/sessions — dual-track advancement (#240)", () => {
  test("a payload without a track defaults to primary and advances currentDay", async () => {
    const user = await makeUser({ currentDay: 56, dualTrackEnabled: true, secondTrackDay: 3 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 56 })));
    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.track).toBe("primary");

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(57);
    expect(row!.secondTrackDay).toBe(3);
  });

  test("a completed second-track sit advances secondTrackDay and leaves currentDay untouched", async () => {
    const user = await makeUser({ currentDay: 56, dualTrackEnabled: true, secondTrackDay: 3 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 3, track: "second" })));
    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.track).toBe("second");

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(56);
    expect(row!.secondTrackDay).toBe(4);
  });

  test("a second-track sit is ignored for advancement when dual-track is not enabled", async () => {
    const user = await makeUser({ currentDay: 56, dualTrackEnabled: false, secondTrackDay: 1 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 1, track: "second" })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(56);
    expect(row!.secondTrackDay).toBe(1);
  });

  test("an incomplete second-track sit does not advance secondTrackDay", async () => {
    const user = await makeUser({ currentDay: 56, dualTrackEnabled: true, secondTrackDay: 5 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(
      sessionRequest(baseSessionBody({ dayNumber: 5, track: "second", completed: false })),
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.secondTrackDay).toBe(5);
  });

  test("a quick second-track sit never advances either counter", async () => {
    const user = await makeUser({ currentDay: 56, dualTrackEnabled: true, secondTrackDay: 5 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(
      sessionRequest(baseSessionBody({ dayNumber: 5, track: "second", sessionType: "quick", duration: 60 })),
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(56);
    expect(row!.secondTrackDay).toBe(5);
  });

  test("an invalid track value is rejected with 400", async () => {
    const user = await makeUser({ currentDay: 56, dualTrackEnabled: true });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ track: "bogus" })));
    expect(res.status).toBe(400);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(0);
  });
});
