/**
 * Issue #837 (focus activity tracking 3/5, #765): POST /api/sessions stores what a
 * focus session was for (`focusCategory`) and GET returns it. The category is
 * read only for a focus session, the way `breathCount` is read only for breath,
 * and it is a label: every category steps the one shared focus goal. Route-level
 * tests against a real in-process Postgres (PGlite).
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, users } from "@/db/schema";
import { FOCUS_CATEGORIES } from "@/lib/constants";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { GET, POST } from "./route";

let db: TestDb;
let seq = 0;

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  seq += 1;
  const [user] = await db
    .insert(users)
    .values({ email: `focus837-${seq}@test.local`, username: `focus837_${seq}`, ...overrides })
    .returning();
  getCurrentUser.mockResolvedValue({ userId: user!.id, email: user!.email });
  return user!;
}

async function loadUser(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row!;
}

async function storedRows(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

function sessionRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test.local/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(): NextRequest {
  return new NextRequest("http://test.local/api/sessions?today=2026-10-26");
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

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/sessions — focus category (#837)", () => {
  test("a focus session with each category is stored with it", async () => {
    const user = await makeUser();

    for (const category of FOCUS_CATEGORIES) {
      const res = await POST(sessionRequest(focusBody({ focusCategory: category })));
      expect(res.status).toBe(200);
      const { session } = await res.json();
      expect(session.sessionType).toBe("focus");
      expect(session.focusCategory).toBe(category);
    }

    const rows = await storedRows(user.id);
    expect(rows.map(row => row.focusCategory).sort()).toEqual([...FOCUS_CATEGORIES].sort());
  });

  test("a focus session without a category, as before #837, is stored with none", async () => {
    const user = await makeUser();

    const absent = await POST(sessionRequest(focusBody()));
    expect(absent.status).toBe(200);
    expect((await absent.json()).session.focusCategory).toBeNull();

    // An entry queued offline may carry an explicit null.
    const explicitNull = await POST(sessionRequest(focusBody({ focusCategory: null })));
    expect(explicitNull.status).toBe(200);
    expect((await explicitNull.json()).session.focusCategory).toBeNull();

    const rows = await storedRows(user.id);
    expect(rows.map(row => row.focusCategory)).toEqual([null, null]);
  });

  test("an invalid category is a 400 that saves nothing and leaves the goal alone", async () => {
    const user = await makeUser({ focusActivityDay: 3 });

    for (const focusCategory of ["Reading", "WRITING", "", "music", 42, true, {}, ["reading"]]) {
      const res = await POST(sessionRequest(focusBody({ dayNumber: 3, duration: 180, focusCategory })));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid focus category" });
    }

    expect(await storedRows(user.id)).toHaveLength(0);
    expect((await loadUser(user.id)).focusActivityDay).toBe(3);
  });

  test("every other session type stores no category, whatever was sent", async () => {
    const user = await makeUser({ currentDay: 5 });

    for (const [sessionType, focusCategory] of [
      ["standard", "reading"],
      ["quick", "writing"],
      ["breath", "listening"],
      // Not read at all, so a value that would be invalid on a focus session is
      // not a 400 here either, as with `breathCount`.
      ["standard", "Reading"],
      ["quick", 42],
    ] as const) {
      const res = await POST(
        sessionRequest(focusBody({ sessionType, dayNumber: 5, duration: 100, clearPercent: 80, focusCategory })),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).session.focusCategory).toBeNull();
    }

    const rows = await storedRows(user.id);
    expect(rows).toHaveLength(5);
    expect(rows.every(row => row.focusCategory === null)).toBe(true);
  });

  test("the category is a label: each one steps the same shared goal", async () => {
    const user = await makeUser({ focusActivityDay: 12 });

    const reading = await POST(sessionRequest(focusBody({ dayNumber: 12, duration: 720, focusCategory: "reading" })));
    expect(reading.status).toBe(200);
    expect((await loadUser(user.id)).focusActivityDay).toBe(13);

    const writing = await POST(sessionRequest(focusBody({ dayNumber: 13, duration: 780, focusCategory: "writing" })));
    expect(writing.status).toBe(200);
    expect((await loadUser(user.id)).focusActivityDay).toBe(14);
  });

  test("a replayed clientSessionId returns the stored category without a second row", async () => {
    const user = await makeUser();
    const body = focusBody({ focusCategory: "listening", clientSessionId: "8a3b5c7d-1e2f-4a6b-9c8d-7e6f5a4b3c2d" });

    const first = await POST(sessionRequest(body));
    expect(first.status).toBe(200);
    const second = await POST(sessionRequest(body));
    expect(second.status).toBe(200);
    const replay = await second.json();
    expect(replay.already).toBe(true);
    expect(replay.session.focusCategory).toBe("listening");

    expect(await storedRows(user.id)).toHaveLength(1);
  });
});

describe("GET /api/sessions — focus category (#837)", () => {
  test("returns each row's category, and null for rows without one", async () => {
    await makeUser({ currentDay: 2 });

    expect((await POST(sessionRequest(focusBody({ focusCategory: "writing" })))).status).toBe(200);
    expect((await POST(sessionRequest(focusBody({ dayNumber: 2, duration: 120 })))).status).toBe(200);
    expect(
      (await POST(sessionRequest(focusBody({ sessionType: "standard", dayNumber: 2, duration: 70, clearPercent: 90 })))).status,
    ).toBe(200);

    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const { sessions: list } = await res.json();
    const pairs = list
      .map((s: { sessionType: string; focusCategory: string | null }) => [s.sessionType, s.focusCategory])
      .sort((a: unknown[], b: unknown[]) => String(a).localeCompare(String(b)));
    expect(pairs).toEqual([
      ["focus", null],
      ["focus", "writing"],
      ["standard", null],
    ]);
  });
});
