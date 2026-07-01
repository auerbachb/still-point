/**
 * Issue #238 — the `users_recovery_all_or_none` check constraint must reject any
 * partially-set recovery trio (schema.ts is the source of truth; this guards
 * against a future edit accidentally dropping or weakening the constraint).
 */
import { afterAll, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { closeTestDb, getTestDb } from "@/lib/testing/pgliteTestDb";

afterAll(async () => {
  await closeTestDb();
});

describe("users_recovery_all_or_none check constraint", () => {
  test("rejects a partially-set recovery trio", async () => {
    const db = await getTestDb();
    await expect(
      db.execute(sql`
        insert into ${users} (email, username, recovery_target_day)
        values ('partial-constraint@test.local', 'partial_constraint', 5)
      `),
    ).rejects.toThrow();
  });

  test("accepts all three recovery fields set together", async () => {
    const db = await getTestDb();
    await expect(
      db.execute(sql`
        insert into ${users} (email, username, recovery_target_day, recovery_current_step, recovery_total_steps)
        values ('full-constraint@test.local', 'full_constraint', 5, 1, 3)
      `),
    ).resolves.toBeDefined();
  });

  test("accepts all three recovery fields left null", async () => {
    const db = await getTestDb();
    await expect(
      db.execute(sql`
        insert into ${users} (email, username)
        values ('null-constraint@test.local', 'null_constraint')
      `),
    ).resolves.toBeDefined();
  });
});
