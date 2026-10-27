/**
 * Issue #835 (focus activity tracking 1/5, #765): PATCH /api/settings returns
 * the focus goal counter on both write paths: the plain update (`RETURN_FIELDS`)
 * and a username change (`atomicUpdateUsername`'s own projection, which
 * `route.test.ts` mocks). The iOS client adopts this response wholesale, so a
 * column missing from either path is reset on the device (#664). Runs against a
 * real in-process Postgres (PGlite).
 */
import type { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { PATCH } from "./route";

let db: TestDb;
let seq = 0;

async function makeUser(focusActivityDay: number) {
  seq += 1;
  const [user] = await db
    .insert(users)
    .values({ email: `settings835-${seq}@test.local`, username: `settings835_${seq}`, focusActivityDay })
    .returning();
  getCurrentUser.mockResolvedValue({ userId: user!.id, email: user!.email });
  return user!;
}

async function patch(body: Record<string, unknown>) {
  const res = await PATCH(
    new Request("http://test.local/api/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }) as NextRequest,
  );
  expect(res.status).toBe(200);
  return (await res.json()).user as Record<string, unknown>;
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("PATCH /api/settings — focusActivityDay (#835)", () => {
  test("a settings toggle on an account at focus goal day 5 still returns 5", async () => {
    await makeUser(5);

    const user = await patch({ isPublic: true });

    expect(user.isPublic).toBe(true);
    expect(user.focusActivityDay).toBe(5);
  });

  test("a username change returns 5 too, through atomicUpdateUsername", async () => {
    const created = await makeUser(5);

    const user = await patch({ username: `renamed835_${seq}` });

    expect(user.username).toBe(`renamed835_${seq}`);
    expect(user.id).toBe(created.id);
    expect(user.focusActivityDay).toBe(5);
  });

  test("both write paths return the same user fields", async () => {
    await makeUser(3);

    const toggled = await patch({ aphorismsEnabled: true });
    const renamed = await patch({ username: `parity835_${seq}` });

    expect(Object.keys(renamed).sort()).toEqual(Object.keys(toggled).sort());
  });
});
