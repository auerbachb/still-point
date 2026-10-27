/**
 * Issue #890 (combine today's sits 1/5, #769) — a combined sit is today's two
 * sits done as one: one standard primary-track row with `combined = true`. A
 * completed one moves `currentDay` (or the recovery ramp) and `secondTrackDay`
 * by exactly one each, in the same statement as the insert. The server checks
 * the request's shape, not the user's state. Route-level tests against a real
 * in-process Postgres (PGlite).
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
    .values({ email: `comb890-${seq}@test.local`, username: `comb890_${seq}`, ...overrides })
    .returning()
    .then((rows) => rows[0]!);
}

/** Signs in a user on primary day 56 and second-track day 3, dual-track unless overridden. */
async function signIn(overrides: Partial<typeof users.$inferInsert> = {}) {
  const user = await makeUser({ currentDay: 56, dualTrackEnabled: true, secondTrackDay: 3, ...overrides });
  getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });
  return user;
}

function sessionRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test.local/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Today's two sits as one: Track One's 600s plus Track Two's 80s. */
function combinedSessionBody(overrides: Record<string, unknown> = {}) {
  return {
    dayNumber: 56,
    duration: 680,
    actualTime: 680,
    clearPercent: 90,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate: "2026-10-26",
    completed: true,
    sessionType: "standard",
    combined: true,
    ...overrides,
  };
}

async function userRow(userId: string) {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  return row!;
}

function sessionRows(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/sessions — combined sits (#890)", () => {
  test("a completed combined sit is one primary row and moves each counter by one", async () => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.already).toBeUndefined();
    expect(json.session).toMatchObject({
      combined: true,
      track: "primary",
      sessionType: "standard",
      completed: true,
      duration: 680,
    });

    const rows = await sessionRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ combined: true, track: "primary", sessionType: "standard" });

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(57);
    expect(row.secondTrackDay).toBe(4);
    expect(row.recoveryTargetDay).toBeNull();
    expect(row.recoveryCurrentStep).toBeNull();
    expect(row.recoveryTotalSteps).toBeNull();
  });

  test("an ended-early combined sit is stored as combined and moves neither counter", async () => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody({ completed: false, actualTime: 300 })));
    expect(res.status).toBe(200);

    const rows = await sessionRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ combined: true, completed: false, track: "primary" });

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(56);
    expect(row.secondTrackDay).toBe(3);
  });

  test("replaying a clientSessionId returns the stored row and moves neither counter again", async () => {
    const user = await signIn();
    const body = combinedSessionBody({ clientSessionId: "89000000-0000-4000-8000-000000000001" });

    const first = await POST(sessionRequest(body));
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.already).toBeUndefined();

    const second = await POST(sessionRequest(body));
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.already).toBe(true);
    expect(secondJson.session.id).toBe(firstJson.session.id);
    expect(secondJson.session.combined).toBe(true);

    expect(await sessionRows(user.id)).toHaveLength(1);
    const row = await userRow(user.id);
    expect(row.currentDay).toBe(57);
    expect(row.secondTrackDay).toBe(4);
  });

  test.each([
    ["the string \"yes\"", "yes"],
    ["the string \"true\"", "true"],
    ["a number", 1],
    ["an object", {}],
  ])("a combined value that is %s is a 400 and stores nothing", async (_label, combined) => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody({ combined })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid combined value" });

    expect(await sessionRows(user.id)).toHaveLength(0);
    const row = await userRow(user.id);
    expect(row.currentDay).toBe(56);
    expect(row.secondTrackDay).toBe(3);
  });

  test.each([
    ["track: second", { track: "second" }],
    ["sessionType: quick", { sessionType: "quick", duration: 60, actualTime: 60 }],
    ["sessionType: breath", { sessionType: "breath" }],
    ["sessionType: focus", { sessionType: "focus" }],
  ])("a combined sit with %s is a 400 and stores nothing", async (_label, overrides) => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody(overrides)));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid combined session" });

    expect(await sessionRows(user.id)).toHaveLength(0);
    const row = await userRow(user.id);
    expect(row.currentDay).toBe(56);
    expect(row.secondTrackDay).toBe(3);
    expect(row.focusActivityDay).toBe(1);
  });

  test("an explicit primary track is accepted", async () => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody({ track: "primary" })));
    expect(res.status).toBe(200);

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(57);
    expect(row.secondTrackDay).toBe(4);
  });

  test("from a single-track account it is stored and degrades to a plain primary sit", async () => {
    const user = await signIn({ dualTrackEnabled: false });

    const res = await POST(sessionRequest(combinedSessionBody()));
    expect(res.status).toBe(200);

    const rows = await sessionRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.combined).toBe(true);

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(57);
    expect(row.secondTrackDay).toBe(3);
  });

  test("mid-recovery it steps the ramp once, as a plain primary sit does, and moves the second track", async () => {
    const user = await signIn({
      currentDay: 11,
      recoveryTargetDay: 11,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });

    const res = await POST(sessionRequest(combinedSessionBody({ dayNumber: 11 })));
    expect(res.status).toBe(200);

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(11);
    expect(row.recoveryTargetDay).toBe(11);
    expect(row.recoveryCurrentStep).toBe(3);
    expect(row.recoveryTotalSteps).toBe(5);
    expect(row.secondTrackDay).toBe(4);
  });

  test.each([
    ["absent", undefined],
    ["false", false],
    ["null", null],
  ])("combined %s is an ordinary primary sit", async (_label, combined) => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody({ combined })));
    expect(res.status).toBe(200);
    const { session } = await res.json();
    expect(session.combined).toBe(false);

    const rows = await sessionRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.combined).toBe(false);

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(57);
    expect(row.secondTrackDay).toBe(3);
  });

  test("combined false with a second-track sit still moves only the second track", async () => {
    const user = await signIn();

    const res = await POST(sessionRequest(combinedSessionBody({ combined: false, track: "second", dayNumber: 3 })));
    expect(res.status).toBe(200);

    const row = await userRow(user.id);
    expect(row.currentDay).toBe(56);
    expect(row.secondTrackDay).toBe(4);
  });
});
