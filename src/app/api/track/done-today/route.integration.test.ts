/**
 * Issue #240 — lightweight per-track completion badges. This route should avoid
 * downloading full session history by filtering to completed standard sits for
 * one authenticated user and one client-local calendar date.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
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
    .values({ email: `track-done-${seq}@test.local`, username: `track_done_${seq}`, ...overrides })
    .returning()
    .then((rows) => rows[0]!);
}

function doneTodayRequest(date = "2026-06-11") {
  return new NextRequest(`http://test.local/api/track/done-today?date=${date}`);
}

async function insertSession(userId: string, overrides: Partial<typeof sessions.$inferInsert> = {}) {
  await db.insert(sessions).values({
    userId,
    dayNumber: 1,
    sessionType: "standard",
    track: "primary",
    duration: 60,
    completed: true,
    actualTime: 60,
    clearPercent: 90,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate: "2026-06-11",
    ...overrides,
  });
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("GET /api/track/done-today", () => {
  test("returns per-track completion using only matching completed standard sessions", async () => {
    const user = await makeUser();
    const other = await makeUser();
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    await insertSession(user.id, { track: "primary" });
    await insertSession(user.id, { track: "second", completed: false });
    await insertSession(user.id, { track: "second", sessionType: "quick" });
    await insertSession(user.id, { track: "second", sessionDate: "2026-06-10" });
    await insertSession(other.id, { track: "second" });

    const res = await GET(doneTodayRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tracksDoneToday: { primary: true, second: false },
    });
  });

  test("counts second-track completion independently", async () => {
    const user = await makeUser();
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });
    await insertSession(user.id, { track: "second" });

    const res = await GET(doneTodayRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      tracksDoneToday: { primary: false, second: true },
    });
  });

  test("rejects invalid calendar dates", async () => {
    const user = await makeUser();
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(doneTodayRequest("not-a-date"));
    expect(res.status).toBe(400);
  });

  test("requires the client-local calendar date", async () => {
    const user = await makeUser();
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await GET(new NextRequest("http://test.local/api/track/done-today"));
    expect(res.status).toBe(400);
  });

  test("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await GET(doneTodayRequest());
    expect(res.status).toBe(401);
  });
});
