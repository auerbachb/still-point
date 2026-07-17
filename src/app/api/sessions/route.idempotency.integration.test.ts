/**
 * Issue #557 — idempotent POST /api/sessions via clientSessionId.
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
    .values({ email: `idemp557-${seq}@test.local`, username: `idemp557_${seq}`, ...overrides })
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
    sessionDate: "2026-07-17",
    completed: true,
    sessionType: "standard",
    track: "primary",
    ...overrides,
  };
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/sessions — clientSessionId idempotency (#557)", () => {
  test("repeated POST with the same clientSessionId returns the existing row and does not advance currentDay twice", async () => {
    const user = await makeUser({ currentDay: 3 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const clientSessionId = "550e8400-e29b-41d4-a716-446655440000";
    const body = baseSessionBody({ dayNumber: 3, clientSessionId });

    const first = await POST(sessionRequest(body));
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson.already).toBeUndefined();
    expect(firstJson.session.id).toBeTruthy();

    const [afterFirst] = await db.select().from(users).where(eq(users.id, user.id));
    expect(afterFirst!.currentDay).toBe(4);

    const second = await POST(sessionRequest(body));
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.already).toBe(true);
    expect(secondJson.session.id).toBe(firstJson.session.id);

    const [afterSecond] = await db.select().from(users).where(eq(users.id, user.id));
    expect(afterSecond!.currentDay).toBe(4);

    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clientSessionId).toBe(clientSessionId);
  });

  test("rejects invalid clientSessionId", async () => {
    const user = await makeUser();
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST(sessionRequest(baseSessionBody({ clientSessionId: "not-a-uuid" })));
    expect(res.status).toBe(400);
  });
});
