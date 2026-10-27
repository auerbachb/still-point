/**
 * Issue #835 (focus activity tracking 1/5, #765): POST /api/sessions stores
 * `focus` sessions and steps the user's focus goal counter (`focusActivityDay`)
 * in the same atomic statement as the insert, without touching the meditation
 * columns. Route-level tests against a real in-process Postgres (PGlite).
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

/** A dual-track user mid-recovery, so every meditation column has a value a stray write would change. */
const MEDITATION_STATE = {
  currentDay: 20,
  dualTrackEnabled: true,
  secondTrackDay: 4,
  recoveryTargetDay: 20,
  recoveryCurrentStep: 2,
  recoveryTotalSteps: 5,
} as const;

function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  seq += 1;
  return db
    .insert(users)
    .values({ email: `focus835-${seq}@test.local`, username: `focus835_${seq}`, ...overrides })
    .returning()
    .then((rows) => rows[0]!);
}

async function loadUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row!;
}

function sessionRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test.local/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function focusBody(overrides: Record<string, unknown> = {}) {
  return {
    dayNumber: 1,
    duration: 60,
    actualTime: 60,
    clearPercent: 0,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate: "2026-10-26",
    completed: true,
    sessionType: "focus",
    ...overrides,
  };
}

function expectMeditationStateUnchanged(row: typeof users.$inferSelect) {
  expect(row.currentDay).toBe(MEDITATION_STATE.currentDay);
  expect(row.secondTrackDay).toBe(MEDITATION_STATE.secondTrackDay);
  expect(row.recoveryTargetDay).toBe(MEDITATION_STATE.recoveryTargetDay);
  expect(row.recoveryCurrentStep).toBe(MEDITATION_STATE.recoveryCurrentStep);
  expect(row.recoveryTotalSteps).toBe(MEDITATION_STATE.recoveryTotalSteps);
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/sessions — focus sessions (#835)", () => {
  test("a completed focus session is stored as focus and moves focusActivityDay from 1 to 2", async () => {
    const user = await makeUser(MEDITATION_STATE);
    expect(user.focusActivityDay).toBe(1);
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(focusBody()));
    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.sessionType).toBe("focus");

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionType).toBe("focus");
    expect(rows[0]!.completed).toBe(true);

    const after = await loadUser(user.id);
    expect(after.focusActivityDay).toBe(2);
    expectMeditationStateUnchanged(after);
  });

  test("a focus session sent on the second track still leaves second_track_day alone", async () => {
    const user = await makeUser(MEDITATION_STATE);
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(focusBody({ track: "second" })));
    expect(res.status).toBe(200);

    const after = await loadUser(user.id);
    expect(after.focusActivityDay).toBe(2);
    expectMeditationStateUnchanged(after);
  });

  test("an ended-early focus session is saved but does not move the goal", async () => {
    const user = await makeUser(MEDITATION_STATE);
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(focusBody({ completed: false, actualTime: 25 })));
    expect(res.status).toBe(200);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sessionType).toBe("focus");
    expect(rows[0]!.completed).toBe(false);

    const after = await loadUser(user.id);
    expect(after.focusActivityDay).toBe(1);
    expectMeditationStateUnchanged(after);
  });

  test("every completed focus session steps the goal, with no once-a-day limit", async () => {
    const user = await makeUser({ focusActivityDay: 7 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    expect((await POST(sessionRequest(focusBody({ dayNumber: 7, duration: 420 })))).status).toBe(200);
    expect((await POST(sessionRequest(focusBody({ dayNumber: 8, duration: 480 })))).status).toBe(200);

    const after = await loadUser(user.id);
    expect(after.focusActivityDay).toBe(9);
    expect(after.currentDay).toBe(1);
  });

  test("a replayed clientSessionId returns already: true and the goal advances once", async () => {
    const user = await makeUser(MEDITATION_STATE);
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const clientSessionId = "6f1c2a4e-8b3d-4c5e-9f60-718293a4b5c6";
    const body = focusBody({ clientSessionId });

    const first = await POST(sessionRequest(body));
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.already).toBeUndefined();
    expect((await loadUser(user.id)).focusActivityDay).toBe(2);

    const second = await POST(sessionRequest(body));
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.already).toBe(true);
    expect(secondJson.session.id).toBe(firstJson.session.id);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    const after = await loadUser(user.id);
    expect(after.focusActivityDay).toBe(2);
    expectMeditationStateUnchanged(after);
  });

  test("a completed standard sit advances currentDay and leaves focusActivityDay alone", async () => {
    const user = await makeUser({ currentDay: 5, focusActivityDay: 3 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(
      sessionRequest(focusBody({ sessionType: "standard", dayNumber: 5, duration: 100, clearPercent: 90 })),
    );
    expect(res.status).toBe(200);

    const after = await loadUser(user.id);
    expect(after.currentDay).toBe(6);
    expect(after.focusActivityDay).toBe(3);
  });

  test("quick and breath sessions leave focusActivityDay alone", async () => {
    const user = await makeUser({ focusActivityDay: 3 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    expect((await POST(sessionRequest(focusBody({ sessionType: "quick" })))).status).toBe(200);
    expect((await POST(sessionRequest(focusBody({ sessionType: "breath", breathCount: 12 })))).status).toBe(200);

    expect((await loadUser(user.id)).focusActivityDay).toBe(3);
  });

  test("an unknown session type such as \"Focus\" is still rejected with 400", async () => {
    const user = await makeUser();
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(focusBody({ sessionType: "Focus" })));
    expect(res.status).toBe(400);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(0);
    expect((await loadUser(user.id)).focusActivityDay).toBe(1);
  });
});
