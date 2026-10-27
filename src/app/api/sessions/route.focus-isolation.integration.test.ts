/**
 * Issue #835 (focus activity tracking 1/5, #765): a focus session is not a
 * meditation sit. These surfaces already filter to standard sits, and a
 * completed focus session must leave every one of them unchanged: the streak
 * and averages (`calculateSessionStats`), the board entry, the done-today
 * badges and missed-day recovery detection in `/api/auth/me`. Route-level tests
 * against a real in-process Postgres (PGlite).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/db/schema";
import { calculateSessionStats } from "@/lib/constants";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { GET as getSessions, POST as postSession } from "./route";
import { GET as getBoard } from "../board/route";
import { GET as getMe } from "../auth/me/route";
import { GET as getDoneToday } from "../track/done-today/route";

const TODAY = "2026-10-26";
/** Three consecutive completed standard sits, then a gap long enough to start recovery today. */
const HISTORY_DATES = ["2026-10-19", "2026-10-20", "2026-10-21"];

let db: TestDb;
let seq = 0;

async function makeMeditator() {
  seq += 1;
  const [user] = await db
    .insert(users)
    .values({
      email: `focus-iso-${seq}@test.local`,
      username: `focus_iso_${seq}`,
      isPublic: true,
      currentDay: 12,
    })
    .returning();
  for (const [index, sessionDate] of HISTORY_DATES.entries()) {
    await db.insert(sessions).values({
      userId: user!.id,
      dayNumber: 9 + index,
      sessionType: "standard",
      track: "primary",
      duration: 140 + index * 10,
      completed: true,
      actualTime: 140 + index * 10,
      clearPercent: 70 + index * 10,
      thoughtCount: 2,
      mindStateLog: [],
      sessionDate,
    });
  }
  return user!;
}

function signIn(user: { id: string; email: string }) {
  getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });
}

async function postCompletedFocusSession() {
  const res = await postSession(
    new NextRequest("http://test.local/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dayNumber: 1,
        duration: 600,
        actualTime: 600,
        clearPercent: 100,
        thoughtCount: 0,
        mindStateLog: [],
        sessionDate: TODAY,
        completed: true,
        sessionType: "focus",
        track: "primary",
      }),
    }),
  );
  expect(res.status).toBe(200);
}

/** The `calculateSessionStats` slice of `GET /api/sessions` (period stats count any session by design). */
async function sessionStats() {
  const res = await getSessions(new NextRequest(`http://test.local/api/sessions?today=${TODAY}`));
  expect(res.status).toBe(200);
  const { stats } = await res.json();
  return {
    streak: stats.streak,
    avgClearPercent: stats.avgClearPercent,
    avgThoughtsPerSession: stats.avgThoughtsPerSession,
    avgThoughtsPerMinute: stats.avgThoughtsPerMinute,
    bonusSecondsTotal: stats.bonusSecondsTotal,
  };
}

async function boardEntry(username: string) {
  const res = await getBoard();
  expect(res.status).toBe(200);
  const { board } = await res.json();
  return (board as Array<{ username: string }>).find((entry) => entry.username === username);
}

async function doneToday() {
  const res = await getDoneToday(new NextRequest(`http://test.local/api/track/done-today?date=${TODAY}`));
  expect(res.status).toBe(200);
  return (await res.json()).tracksDoneToday;
}

async function recoveryFromMe() {
  const res = await getMe(new NextRequest(`http://test.local/api/auth/me?date=${TODAY}`));
  expect(res.status).toBe(200);
  const { user } = await res.json();
  return {
    currentDay: user.currentDay,
    recoveryTargetDay: user.recoveryTargetDay,
    recoveryCurrentStep: user.recoveryCurrentStep,
    recoveryTotalSteps: user.recoveryTotalSteps,
  };
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("a completed focus session does not count as meditating (#835)", () => {
  test("streak and averages are unchanged", async () => {
    const user = await makeMeditator();
    signIn(user);
    const before = await sessionStats();
    expect(before.streak).toBe(3);

    await postCompletedFocusSession();

    expect(await sessionStats()).toEqual(before);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows.some((row) => row.sessionType === "focus")).toBe(true);
    expect(calculateSessionStats(rows)).toEqual(
      calculateSessionStats(rows.filter((row) => row.sessionType !== "focus")),
    );
  });

  test("the board entry is unchanged", async () => {
    const user = await makeMeditator();
    signIn(user);
    const before = await boardEntry(user.username);
    expect(before).toMatchObject({ currentDay: 12, streak: 3, totalSessions: 3 });

    await postCompletedFocusSession();

    expect(await boardEntry(user.username)).toEqual(before);
  });

  test("the done-today badges are unchanged", async () => {
    const user = await makeMeditator();
    signIn(user);
    const before = await doneToday();
    expect(before).toEqual({ primary: false, second: false });

    await postCompletedFocusSession();

    expect(await doneToday()).toEqual(before);
  });

  test("missed-day recovery detection is unchanged", async () => {
    // Recovery detection persists what it finds, so compare against an identical
    // meditator who never ran a focus session instead of reading /me twice.
    const control = await makeMeditator();
    signIn(control);
    const expected = await recoveryFromMe();
    expect(expected).toEqual({
      currentDay: 12,
      recoveryTargetDay: 12,
      recoveryCurrentStep: 1,
      recoveryTotalSteps: 5,
    });

    const user = await makeMeditator();
    signIn(user);
    await postCompletedFocusSession();

    expect(await recoveryFromMe()).toEqual(expected);
  });
});
