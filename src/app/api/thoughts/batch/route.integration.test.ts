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

/**
 * Issue #792 — clearing a saved completion note. Bodies match what both clients
 * send for an emptied note: the web completion screen and offline queue, and
 * iOS `BatchThoughtsRequest(..., clearCompletionNote: true)`.
 */
describe("POST /api/thoughts/batch — clearCompletionNote (#792)", () => {
  async function seedNoteAndThought() {
    await db.insert(thoughts).values([
      { userId, sessionId, dayNumber: 3, timeInSession: 12, text: "phone buzzed" },
      { userId, sessionId, dayNumber: 3, timeInSession: -1, text: "saved note" },
    ]);
  }

  async function storedRows() {
    const rows = await db.select().from(thoughts).where(eq(thoughts.sessionId, sessionId));
    return rows.map((r) => [r.timeInSession, r.text]).sort();
  }

  test("a clear-only request deletes the completion note and keeps in-sit thoughts", async () => {
    await seedNoteAndThought();

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[],"clearCompletionNote":true}`,
      ),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).thoughts).toEqual([]);
    expect(await storedRows()).toEqual([[12, "phone buzzed"]]);
  });

  test("clearing a session that has no note succeeds and changes nothing", async () => {
    await db.insert(thoughts).values({
      userId, sessionId, dayNumber: 3, timeInSession: 12, text: "phone buzzed",
    });

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[],"clearCompletionNote":true}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await storedRows()).toEqual([[12, "phone buzzed"]]);
  });

  test("a clear sent with queued in-sit thoughts inserts them and still deletes the note", async () => {
    await db.insert(thoughts).values({
      userId, sessionId, dayNumber: 3, timeInSession: -1, text: "saved note",
    });

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"clearCompletionNote":true,` +
          `"thoughts":[{"timeInSession":47,"text":"breathing settled"}]}`,
      ),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).thoughts).toHaveLength(1);
    expect(await storedRows()).toEqual([[47, "breathing settled"]]);
  });

  test("a clear sent with a new completion note replaces the stored one", async () => {
    await seedNoteAndThought();

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"clearCompletionNote":true,` +
          `"thoughts":[{"timeInSession":-1,"text":"rewritten note"}]}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await storedRows()).toEqual([
      [-1, "rewritten note"],
      [12, "phone buzzed"],
    ]);
  });

  test("clearCompletionNote false keeps an empty batch a no-op", async () => {
    await seedNoteAndThought();

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[],"clearCompletionNote":false}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await storedRows()).toEqual([
      [-1, "saved note"],
      [12, "phone buzzed"],
    ]);
  });

  test.each([
    ["a string", `"true"`],
    ["a number", "1"],
    ["null", "null"],
  ])("a clearCompletionNote that is %s fails with 400 and deletes nothing", async (_label, value) => {
    await seedNoteAndThought();

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[],"clearCompletionNote":${value}}`,
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid clearCompletionNote");
    expect(await storedRows()).toEqual([
      [-1, "saved note"],
      [12, "phone buzzed"],
    ]);
  });

  test("a clear with a day number mismatch fails with 400 and deletes nothing", async () => {
    await seedNoteAndThought();

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":99,"thoughts":[],"clearCompletionNote":true}`,
      ),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Day number mismatch");
    expect(await storedRows()).toHaveLength(2);
  });

  test("a clear against another user's session returns 404 and deletes nothing", async () => {
    await seedNoteAndThought();
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other227@test.local" });

    const res = await POST(
      batchRequest(
        `{"sessionId":"${sessionId}","dayNumber":3,"thoughts":[],"clearCompletionNote":true}`,
      ),
    );

    expect(res.status).toBe(404);
    expect(await storedRows()).toHaveLength(2);
  });
});

/**
 * Issue #948 — a batch the server stored, but whose response the client never
 * got (the #907 upload deadline, a dropped connection), is sent again. Bodies
 * match what the web offline queue sends from the page (`batchThoughts`) and the
 * service worker: each in-session thought carries the `clientThoughtId` minted
 * when the sit was queued, and the end note carries none.
 */
describe("POST /api/thoughts/batch — client thought ids (#948)", () => {
  const firstId = "94800000-0000-4000-8000-000000000001";
  const secondId = "94800000-0000-4000-8000-000000000002";
  const thirdId = "94800000-0000-4000-8000-000000000003";
  let otherSessionId: string;

  beforeAll(async () => {
    const [other] = await db
      .insert(sessions)
      .values({
        userId: otherUserId,
        dayNumber: 1,
        sessionType: "standard",
        duration: 60,
        completed: true,
        actualTime: 60,
        clearPercent: 50,
        mindStateLog: [],
        sessionDate: "2026-10-27",
      })
      .returning({ id: sessions.id });
    otherSessionId = other!.id;
  });

  beforeEach(async () => {
    await db.delete(thoughts).where(eq(thoughts.sessionId, otherSessionId));
  });

  function post(thoughtItems: unknown[], extra: Record<string, unknown> = {}) {
    return POST(
      batchRequest(JSON.stringify({ sessionId, dayNumber: 3, thoughts: thoughtItems, ...extra })),
    );
  }

  /** Every stored row of the session as [timeInSession, text, clientThoughtId]. */
  async function storedRows(forSessionId = sessionId) {
    const rows = await db.select().from(thoughts).where(eq(thoughts.sessionId, forSessionId));
    return rows.map((r) => [r.timeInSession, r.text, r.clientThoughtId]).sort();
  }

  const batch = [
    { timeInSession: 12, text: "phone buzzed", clientThoughtId: firstId },
    { timeInSession: 47, text: "breathing settled", clientThoughtId: secondId },
  ];

  test("a batch sent twice with the same ids stores its thoughts once, and the second request still succeeds", async () => {
    const first = await post(batch);
    expect(first.status).toBe(200);
    expect((await first.json()).thoughts).toHaveLength(2);

    const replay = await post(batch);

    expect(replay.status).toBe(200);
    // Only what this request inserted, which is nothing.
    expect((await replay.json()).thoughts).toEqual([]);
    expect(await storedRows()).toEqual([
      [12, "phone buzzed", firstId],
      [47, "breathing settled", secondId],
    ]);
  });

  test("an id sent again in other letter case is the same thought", async () => {
    await post(batch);

    const replay = await post(batch.map((t) => ({ ...t, clientThoughtId: t.clientThoughtId.toUpperCase() })));

    expect(replay.status).toBe(200);
    expect(await storedRows()).toHaveLength(2);
  });

  test("a partial replay stores only the thoughts the server does not have yet", async () => {
    await post(batch.slice(0, 1));

    const res = await post([...batch, { timeInSession: 90, text: "settled again", clientThoughtId: thirdId }]);

    expect(res.status).toBe(200);
    expect((await res.json()).thoughts.map((t: { text: string }) => t.text).sort()).toEqual([
      "breathing settled",
      "settled again",
    ]);
    expect(await storedRows()).toEqual([
      [12, "phone buzzed", firstId],
      [47, "breathing settled", secondId],
      [90, "settled again", thirdId],
    ]);
  });

  test("a replay that carries the end note replaces the note once and stores each thought once", async () => {
    await post([...batch, { timeInSession: -1, text: "first draft" }]);

    // The note was edited between the two attempts, as the queue allows.
    const replay = await post([...batch, { timeInSession: -1, text: "edited note" }]);

    expect(replay.status).toBe(200);
    expect((await replay.json()).thoughts).toEqual([
      expect.objectContaining({ timeInSession: -1, text: "edited note" }),
    ]);
    expect(await storedRows()).toEqual([
      [-1, "edited note", null],
      [12, "phone buzzed", firstId],
      [47, "breathing settled", secondId],
    ]);
  });

  test("a replay with clearCompletionNote still deletes the note and stores no thought twice", async () => {
    await post([...batch, { timeInSession: -1, text: "saved note" }]);

    const replay = await post(batch, { clearCompletionNote: true });

    expect(replay.status).toBe(200);
    expect(await storedRows()).toEqual([
      [12, "phone buzzed", firstId],
      [47, "breathing settled", secondId],
    ]);
  });

  test("an end note's id is never stored, so the note is still replaced", async () => {
    await post([{ timeInSession: -1, text: "first draft", clientThoughtId: thirdId }]);

    const res = await post([{ timeInSession: -1, text: "edited note", clientThoughtId: thirdId }]);

    expect(res.status).toBe(200);
    expect(await storedRows()).toEqual([[-1, "edited note", null]]);
  });

  test("a batch without ids, as iOS and entries queued before #948 send, is stored as before — twice if sent twice", async () => {
    const legacy = batch.map(({ timeInSession, text }) => ({ timeInSession, text }));

    await post(legacy);
    const again = await post(legacy);

    expect(again.status).toBe(200);
    expect((await again.json()).thoughts).toHaveLength(2);
    expect(await storedRows()).toEqual([
      [12, "phone buzzed", null],
      [12, "phone buzzed", null],
      [47, "breathing settled", null],
      [47, "breathing settled", null],
    ]);
  });

  test("a replayed batch that mixes both stores only its thoughts without an id again", async () => {
    const mixed = [batch[0]!, { timeInSession: 47, text: "breathing settled" }];

    await post(mixed);
    const replay = await post(mixed);

    expect((await replay.json()).thoughts).toEqual([
      expect.objectContaining({ timeInSession: 47, text: "breathing settled" }),
    ]);
    expect(await storedRows()).toEqual([
      [12, "phone buzzed", firstId],
      [47, "breathing settled", null],
      [47, "breathing settled", null],
    ]);
  });

  test("another user's thought with the same id is stored too", async () => {
    await post(batch);
    getCurrentUser.mockResolvedValue({ userId: otherUserId, email: "other227@test.local" });

    const res = await POST(
      batchRequest(JSON.stringify({ sessionId: otherSessionId, dayNumber: 1, thoughts: batch })),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).thoughts).toHaveLength(2);
    expect(await storedRows(otherSessionId)).toEqual(await storedRows());
  });

  test.each([
    ["not a UUID", "thought-1"],
    ["a number", 948],
  ])("an id that is %s fails with 400 and stores nothing", async (_label, clientThoughtId) => {
    const res = await post([batch[0]!, { timeInSession: 47, text: "breathing settled", clientThoughtId }]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid thoughts payload");
    expect(await storedRows()).toEqual([]);
  });

  test("a batch that repeats an id fails with 400 and stores nothing", async () => {
    const res = await post([
      batch[0]!,
      { timeInSession: 47, text: "breathing settled", clientThoughtId: firstId.toUpperCase() },
    ]);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid thoughts payload");
    expect(await storedRows()).toEqual([]);
  });
});
