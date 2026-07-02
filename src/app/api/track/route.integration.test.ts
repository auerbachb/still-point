/**
 * Issue #240 — dual-track opt-in route. Enabling a second daily track is only
 * allowed once the primary track has passed the 10-minute mark
 * (`currentDay > FORK_DAY`); the flag flip is idempotent. Route-level tests
 * against a real in-process Postgres.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { FORK_DAY } from "@/lib/constants";
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
    .values({ email: `track240-${seq}@test.local`, username: `track240_${seq}`, ...overrides })
    .returning()
    .then((rows) => rows[0]!);
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("POST /api/track — enable dual track (#240)", () => {
  test("enables the second track once past the 10-minute mark", async () => {
    const user = await makeUser({ currentDay: FORK_DAY + 1, dualTrackEnabled: false });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST();
    expect(res.status).toBe(200);
    const { user: returned } = await res.json();
    expect(returned.dualTrackEnabled).toBe(true);
    expect(returned.secondTrackDay).toBe(1);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.dualTrackEnabled).toBe(true);
  });

  test("rejects enabling before the 10-minute mark", async () => {
    const user = await makeUser({ currentDay: FORK_DAY, dualTrackEnabled: false });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST();
    expect(res.status).toBe(409);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.dualTrackEnabled).toBe(false);
  });

  test("is idempotent for an already-enabled account", async () => {
    const user = await makeUser({ currentDay: FORK_DAY + 5, dualTrackEnabled: true, secondTrackDay: 4 });
    getCurrentUser.mockResolvedValue({ userId: user.id, email: user.email });

    const res = await POST();
    expect(res.status).toBe(200);
    const { user: returned } = await res.json();
    expect(returned.dualTrackEnabled).toBe(true);
    expect(returned.secondTrackDay).toBe(4);
  });

  test("401 when unauthenticated", async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
  });
});
