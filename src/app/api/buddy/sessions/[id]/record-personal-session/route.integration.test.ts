/**
 * Issue #227 — make sure note saving works on iOS as well as web.
 *
 * Route-level persistence tests for
 * POST /api/buddy/sessions/[id]/record-personal-session against a real
 * in-process Postgres (PGlite). Request bodies replicate the exact JSON the
 * iOS client encodes (`RecordBuddyPersonalSessionRequest`, locked by
 * RecordBuddyPersonalSessionRequestEncodingTests.swift) so a server
 * regression that drops buddy in-sit thoughts fails here.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  buddySessionParticipants,
  buddySessions,
  sessions,
  thoughts,
  users,
} from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/daily", () => ({ deleteRoom: vi.fn() }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));
vi.mock("@/db/pool", async () => ({
  poolDb: await getTestDb(),
  closePoolDb: async () => {},
}));

import { POST } from "./route";
import { POST as batchPOST } from "@/app/api/thoughts/batch/route";

let db: TestDb;
let userId: string;
let hostUserId: string;
let buddySessionId: string;
let seq = 0;

function recordRequest(rawBody: string, sessionId: string = buddySessionId) {
  const request = new NextRequest(
    `http://test.local/api/buddy/sessions/${sessionId}/record-personal-session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Still-Point-Client": "ios",
      },
      body: rawBody,
    },
  );
  return POST(request, { params: Promise.resolve({ id: sessionId }) });
}

/** Exact field set the iOS client sends (RecordBuddyPersonalSessionRequest). */
const iosBody =
  `{"clearPercent":80,"thoughtCount":1,` +
  `"mindStateLog":[{"time":0,"state":"clear"},{"time":12,"state":"thinking"},{"time":30,"state":"clear"}],` +
  `"actualTime":60,"sessionDate":"2026-06-11",` +
  `"thoughts":[{"timeInSession":42,"text":"iOS buddy note"}]}`;

beforeEach(async () => {
  db = await getTestDb();
  seq += 1;

  const [host] = await db
    .insert(users)
    .values({ email: `host227-${seq}@test.local`, username: `host227_${seq}` })
    .returning({ id: users.id });
  const [buddy] = await db
    .insert(users)
    .values({ email: `buddy227-${seq}@test.local`, username: `buddy227_${seq}`, currentDay: 5 })
    .returning({ id: users.id });
  hostUserId = host!.id;
  userId = buddy!.id;

  const startedAt = new Date(Date.now() - 10 * 60 * 1000);
  const [session] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-227-${seq}`,
      hostUserId,
      state: "completed",
      durationSeconds: 60,
      startedAt,
    })
    .returning({ id: buddySessions.id });
  buddySessionId = session!.id;

  await db.insert(buddySessionParticipants).values([
    { buddySessionId, userId: hostUserId, isHost: true, ready: true },
    { buddySessionId, userId, isHost: false, ready: true },
  ]);

  getCurrentUser.mockResolvedValue({ userId, email: `buddy227-${seq}@test.local` });
});

afterAll(async () => {
  await closeTestDb();
});

describe("POST /api/buddy/sessions/[id]/record-personal-session — iOS payloads persist", () => {
  test("full iOS payload creates the personal session row AND its thoughts atomically", async () => {
    const res = await recordRequest(iosBody);
    expect(res.status).toBe(200);
    const json = await res.json();

    // Response shape the iOS SessionDTO decoder requires.
    expect(json.session).toMatchObject({
      dayNumber: 5,
      sessionType: "standard",
      duration: 60,
      completed: true,
      actualTime: 60,
      clearPercent: 80,
      thoughtCount: 1,
      sessionDate: "2026-06-11",
      buddySessionId,
    });
    expect(typeof json.session.id).toBe("string");

    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.buddySessionId, buddySessionId));
    expect(sessionRow).toBeDefined();
    expect(sessionRow!.userId).toBe(userId);
    expect(sessionRow!.mindStateLog).toEqual([
      { time: 0, state: "clear" },
      { time: 12, state: "thinking" },
      { time: 30, state: "clear" },
    ]);

    const thoughtRows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionRow!.id));
    expect(thoughtRows).toHaveLength(1);
    expect(thoughtRows[0]).toMatchObject({
      userId,
      dayNumber: 5,
      timeInSession: 42,
      text: "iOS buddy note",
    });

    const [userRow] = await db.select().from(users).where(eq(users.id, userId));
    expect(userRow!.currentDay).toBe(6);

    const [participant] = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.userId, userId));
    expect(participant!.participantCompletedAt).not.toBeNull();
  });

  test("omitted thoughts key (Swift nil → absent) saves the session with no thought rows", async () => {
    const res = await recordRequest(
      `{"clearPercent":70,"thoughtCount":0,"mindStateLog":[{"time":0,"state":"clear"}],` +
        `"actualTime":60,"sessionDate":"2026-06-11"}`,
    );
    expect(res.status).toBe(200);

    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.buddySessionId, buddySessionId));
    expect(sessionRow).toBeDefined();
    const thoughtRows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, sessionRow!.id));
    expect(thoughtRows).toHaveLength(0);
  });

  test("explicit null thoughts saves the session with no thought rows", async () => {
    const res = await recordRequest(
      `{"clearPercent":70,"thoughtCount":0,"mindStateLog":[],` +
        `"actualTime":60,"sessionDate":"2026-06-11","thoughts":null}`,
    );
    expect(res.status).toBe(200);

    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.buddySessionId, buddySessionId));
    expect(sessionRow).toBeDefined();
  });

  test("malformed thought entry fails visibly with 400 and creates nothing", async () => {
    const res = await recordRequest(
      `{"clearPercent":70,"thoughtCount":1,"mindStateLog":[],` +
        `"actualTime":60,"sessionDate":"2026-06-11","thoughts":[{"text":"missing timeInSession"}]}`,
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid thoughts payload");

    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.buddySessionId, buddySessionId));
    expect(sessionRows).toHaveLength(0);
    const [userRow] = await db.select().from(users).where(eq(users.id, userId));
    expect(userRow!.currentDay).toBe(5);
  });

  test("repeat record is idempotent: returns already=true without duplicating thoughts", async () => {
    const first = await recordRequest(iosBody);
    expect(first.status).toBe(200);
    const firstJson = await first.json();

    const second = await recordRequest(iosBody);
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.already).toBe(true);
    expect(secondJson.session.id).toBe(firstJson.session.id);

    const thoughtRows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, firstJson.session.id));
    expect(thoughtRows).toHaveLength(1);
  });

  test("full iOS buddy journey: record personal session, then save the completion note via batch", async () => {
    const recordRes = await recordRequest(iosBody);
    expect(recordRes.status).toBe(200);
    const { session } = await recordRes.json();

    // CompletionView.saveEndNote uses the personal session row id + dayNumber.
    const noteRes = await batchPOST(
      new NextRequest("http://test.local/api/thoughts/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Still-Point-Client": "ios",
        },
        body: `{"sessionId":"${session.id}","dayNumber":${session.dayNumber},"thoughts":[{"timeInSession":-1,"text":"buddy sit reflection"}]}`,
      }),
    );

    expect(noteRes.status).toBe(200);
    const noteRows = await db
      .select()
      .from(thoughts)
      .where(eq(thoughts.sessionId, session.id));
    expect(noteRows.map((r) => [r.timeInSession, r.text]).sort()).toEqual([
      [-1, "buddy sit reflection"],
      [42, "iOS buddy note"],
    ]);
  });
});
