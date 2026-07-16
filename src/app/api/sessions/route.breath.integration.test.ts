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

function sessionRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://test.local/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function breathBody(overrides: Record<string, unknown> = {}) {
  return {
    dayNumber: 1,
    duration: 60,
    actualTime: 60,
    clearPercent: 0,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate: "2026-06-11",
    completed: true,
    sessionType: "breath",
    ...overrides,
  };
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/sessions — breathCount write path (#539)", () => {
  test("persists a finite breathCount for breath sessions", async () => {
    seq += 1;
    const [user] = await db
      .insert(users)
      .values({ email: `breath539-${seq}@test.local`, username: `breath539_${seq}` })
      .returning();
    getCurrentUser.mockResolvedValue({ userId: user!.id, email: user!.email });

    const res = await POST(sessionRequest(breathBody({ breathCount: 42 })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(row!.breathCount).toBe(42);
  });

  test("clamps negative breathCount to zero", async () => {
    seq += 1;
    const [user] = await db
      .insert(users)
      .values({ email: `breath539-neg-${seq}@test.local`, username: `breath539n_${seq}` })
      .returning();
    getCurrentUser.mockResolvedValue({ userId: user!.id, email: user!.email });

    const res = await POST(sessionRequest(breathBody({ breathCount: -12.7 })));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(row!.breathCount).toBe(0);
  });

  test("floors fractional breathCount and caps at int32 max", async () => {
    seq += 1;
    const [user] = await db
      .insert(users)
      .values({ email: `breath539-cap-${seq}@test.local`, username: `breath539c_${seq}` })
      .returning();
    getCurrentUser.mockResolvedValue({ userId: user!.id, email: user!.email });

    const res = await POST(
      sessionRequest(breathBody({ breathCount: 2_147_483_647.9 })),
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(row!.breathCount).toBe(2_147_483_647);
  });

  test("ignores breathCount for non-breath session types", async () => {
    seq += 1;
    const [user] = await db
      .insert(users)
      .values({ email: `breath539-std-${seq}@test.local`, username: `breath539s_${seq}` })
      .returning();
    getCurrentUser.mockResolvedValue({ userId: user!.id, email: user!.email });

    const res = await POST(
      sessionRequest(breathBody({ sessionType: "standard", breathCount: 99 })),
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user!.id));
    expect(row!.breathCount).toBeNull();
  });
});
