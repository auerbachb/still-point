/**
 * Issue #238 — miss-a-day recovery: completed standard sits advance the recovery
 * ramp (instead of `currentDay`) while a user is recovering, and normal
 * `currentDay + 1` progression resumes once the ramp completes or was never
 * started. Route-level tests against a real in-process Postgres (PGlite).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
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
    .values({ email: `rec238-${seq}@test.local`, username: `rec238_${seq}`, ...overrides })
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

describe("POST /api/sessions — miss-a-day recovery progression (#238)", () => {
  test("outside recovery, a completed standard sit still bumps currentDay by one (unchanged behavior)", async () => {
    const user = await makeUser({ currentDay: 5 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 5 })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(6);
    expect(row!.recoveryTargetDay).toBeNull();
  });

  test("a quick session never advances currentDay or the recovery ramp", async () => {
    const user = await makeUser({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 11, sessionType: "quick" })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(11);
    expect(row!.recoveryCurrentStep).toBe(2);
  });

  test("an abandoned standard sit mid-recovery does not advance the ramp", async () => {
    const user = await makeUser({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 11, completed: false })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(11);
    expect(row!.recoveryCurrentStep).toBe(2);
    expect(row!.recoveryTotalSteps).toBe(5);
  });

  test("a completed standard sit mid-recovery advances the step and leaves currentDay untouched", async () => {
    const user = await makeUser({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 11 })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(11);
    expect(row!.recoveryTargetDay).toBe(11);
    expect(row!.recoveryCurrentStep).toBe(3);
    expect(row!.recoveryTotalSteps).toBe(5);
  });

  test("completing the final recovery step clears recovery and leaves currentDay at the prior level", async () => {
    const user = await makeUser({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 5,
      recoveryTotalSteps: 5,
    });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 11 })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(11);
    expect(row!.recoveryTargetDay).toBeNull();
    expect(row!.recoveryCurrentStep).toBeNull();
    expect(row!.recoveryTotalSteps).toBeNull();
  });

  test("the session immediately after recovery clears resumes normal +1 progression", async () => {
    const user = await makeUser({ currentDay: 11 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ dayNumber: 11 })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.currentDay).toBe(12);
  });
});
