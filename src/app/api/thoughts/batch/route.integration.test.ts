/**
 * Issue #227 — make sure note saving works on iOS as well as web.
 *
 * Route-level persistence tests for POST /api/thoughts/batch against a real
 * in-process Postgres (PGlite). Request bodies replicate the exact JSON the
 * iOS client encodes (`BatchThoughtsRequest` in
 * ios/StillPointShared/Sources/StillPointShared/DTOs/DTOs.swift, sent by
 * CompletionView.saveEndNote and SessionViewModel.saveSession) so a server
 * regression that breaks iOS note saving fails here.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions, thoughts, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));
vi.mock("@/db/pool", async () => ({
  poolDb: await getTestDb(),
  closePoolDb: async () => {},
}));

import { POST } from "./route";

let db: TestDb;
let userId: string;
let otherUserId: string;
let sessionId: string;

function batchRequest(rawBody: string): NextRequest {
  return new NextRequest("http://test.local/api/thoughts/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Still-Point-Client": "ios",
    },
    body: rawBody,
  });
}

beforeAll(async () => {
  db = await getTestDb();

  const [user] = await db
    .insert(users)
    .values({ email: "ios227@test.local", username: "ios227", currentDay: 3 })
    .returning({ id: users.id });
  const [other] = await db
    .insert(users)
    .values({ email: "other227@test.local", username: "other227" })
    .returning({ id: users.id });
  userId = user!.id;
  otherUserId = other!.id;

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      dayNumber: 3,
      sessionType: "standard",
      duration: 80,
      completed: true,
      actualTime: 80,
      clearPercent: 74,
      thoughtCount: 2,
      mindStateLog: [{ time: 0, state: "clear" }],
      sessionDate: "2026-06-11",
    })
    .returning({ id: sessions.id });
  sessionId = session!.id;
});

beforeEach(async () => {
  getCurrentUser.mockResolvedValue({ userId, email: "ios227@test.local" });
  await db.delete(thoughts).where(eq(thoughts.sessionId, sessionId));
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/thoughts/batch — iOS payloads persist", () => {
  test("in-sit captured thoughts (SessionViewModel.saveSession shape) are inserted", async () => {
    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[` +
          `{"timeInSession":12,"text":"phone buzzed"},` +
          `{"timeInSession":47,"text":"breathing settled"}]}`,
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thoughts).toHaveLength(2);

    const rows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    expect(rows.map((r) => [r.timeInSession, r.text]).sort()).toEqual([
      [12, "phone buzzed"],
      [47, "breathing settled"],
    ]);
    expect(rows.every((r) => r.userId === userId && r.dayNumber === 3)).toBe(true);
  });

  test("completion note (CompletionView.saveEndNote shape, timeInSession -1) is inserted", async () => {
    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[{"timeInSession":-1,"text":"Toilet room L"}]}`,
      ),
    );

    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.timeInSession).toBe(-1);
    expect(rows[0]!.text).toBe("Toilet room L");
  });

  test("re-saving an edited completion note replaces the prior one (no duplicates)", async () => {
    const firstRes = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[{"timeInSession":-1,"text":"first draft"}]}`,
      ),
    );
    expect(firstRes.status).toBe(200);
    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[{"timeInSession":-1,"text":"edited note"}]}`,
      ),
    );

    expect(res.status).toBe(200);
    const noteRows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    const completionNotes = noteRows.filter((r) => r.timeInSession === -1);
    expect(completionNotes).toHaveLength(1);
    expect(completionNotes[0]!.text).toBe("edited note");
  });

  test("whitespace-only note fails visibly with 400 (not silently dropped)", async () => {
    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[{"timeInSession":-1,"text":"   "}]}`,
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid thoughts payload");
    const rows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });

  test("day number mismatch fails visibly with 400", async () => {
    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":99,"thoughts":[{"timeInSession":-1,"text":"note"}]}`,
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Day number mismatch");
    const rows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });

  test("another user's session id returns 404 and persists nothing", async () => {
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other227@test.local" });

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[{"timeInSession":-1,"text":"intrusion"}]}`,
      ),
    );

    expect(res.status).toBe(404);
    const rows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });

  test("multiple completion notes fail visibly with 400", async () => {
    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[` +
          `{"timeInSession":-1,"text":"first note"},` +
          `{"timeInSession":-1,"text":"second note"}]}`,
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid thoughts payload");
    const rows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionId));
    expect(rows).toHaveLength(0);
  });
});
