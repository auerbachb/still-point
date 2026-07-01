/**
 * Issue #238 — miss-a-day recovery: GET /api/auth/me detects a 2+ calendar-day
 * gap since the user's last completed standard sit and persists recovery state.
 * Route-level tests against a real in-process Postgres (PGlite).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { GET } from "./route";

let db: TestDb;
let seq = 0;

function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  seq += 1;
  return db
    .insert(users)
    .values({ email: `me238-${seq}@test.local`, username: `me238_${seq}`, ...overrides })
    .returning()
    .then((rows) => rows[0]!);
}

function meRequest(date?: string): NextRequest {
  const url = date ? `http://test.local/api/auth/me?date=${date}` : "http://test.local/api/auth/me";
  return new NextRequest(url);
}

async function insertCompletedStandardSession(userId: string, sessionDate: string) {
  await db.insert(sessions).values({
    userId,
    dayNumber: 1,
    sessionType: "standard",
    duration: 60,
    completed: true,
    actualTime: 60,
    clearPercent: 90,
    thoughtCount: 0,
    sessionDate,
  });
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("GET /api/auth/me — miss-a-day recovery detection (#238)", () => {
  test("a brand new user with no sessions never enters recovery", async () => {
    const user = await makeUser({ currentDay: 1 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest("2026-06-11"));
    expect(res.status).toBe(200);
    const { user: body } = await res.json();
    expect(body.recoveryTargetDay).toBeNull();
  });

  test("a 1-day gap (normal daily cadence) does not trigger recovery", async () => {
    const user = await makeUser({ currentDay: 11 });
    await insertCompletedStandardSession(user.id, "2026-06-10");
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest("2026-06-11"));
    const { user: body } = await res.json();
    expect(body.recoveryTargetDay).toBeNull();

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.recoveryTargetDay).toBeNull();
  });

  test("a 2+ day gap starts recovery, freezing recoveryTargetDay at currentDay", async () => {
    const user = await makeUser({ currentDay: 11 });
    await insertCompletedStandardSession(user.id, "2026-06-09");
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest("2026-06-11"));
    expect(res.status).toBe(200);
    const { user: body } = await res.json();
    expect(body.recoveryTargetDay).toBe(11);
    expect(body.recoveryCurrentStep).toBe(1);
    expect(body.recoveryTotalSteps).toBe(5);

    // Persisted, not just returned.
    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.recoveryTargetDay).toBe(11);
    expect(row!.recoveryCurrentStep).toBe(1);
    expect(row!.recoveryTotalSteps).toBe(5);
  });

  test("a large gap on day 1 (nothing lost) does not start recovery", async () => {
    const user = await makeUser({ currentDay: 1 });
    await insertCompletedStandardSession(user.id, "2026-05-01");
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest("2026-06-11"));
    const { user: body } = await res.json();
    expect(body.recoveryTargetDay).toBeNull();
  });

  test("does not restart the ramp when already recovering", async () => {
    const user = await makeUser({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 3,
      recoveryTotalSteps: 5,
    });
    // Even a huge additional gap should not reset the in-progress ramp.
    await insertCompletedStandardSession(user.id, "2026-01-01");
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest("2026-06-11"));
    const { user: body } = await res.json();
    expect(body.recoveryCurrentStep).toBe(3);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.recoveryCurrentStep).toBe(3);
  });

  test("falls back to server UTC date when no ?date= query param is given", async () => {
    const user = await makeUser({ currentDay: 4 });
    // Sessions dated far in the past relative to "now" so this deterministically
    // exercises the fallback path without depending on wall-clock timing.
    await insertCompletedStandardSession(user.id, "2000-01-01");
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest());
    expect(res.status).toBe(200);
    const { user: body } = await res.json();
    expect(body.recoveryTargetDay).toBe(4);
  });

  test("an invalid ?date= value falls back to server UTC date rather than throwing", async () => {
    const user = await makeUser({ currentDay: 4 });
    await insertCompletedStandardSession(user.id, "2000-01-01");
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(meRequest("not-a-date"));
    expect(res.status).toBe(200);
    const { user: body } = await res.json();
    expect(body.recoveryTargetDay).toBe(4);
  });
});
