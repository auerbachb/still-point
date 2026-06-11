import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

let instancePromise: Promise<TestDb> | null = null;

/**
 * In-process Postgres (PGlite) wired to the app's Drizzle schema, for
 * route-level integration tests. The schema is created with drizzle-kit's
 * `pushSchema`, so tests always run against exactly what `src/db/schema.ts`
 * declares (the numbered drizzle/*.sql snapshot can lag behind — see
 * scripts/apply-migrations.ts).
 *
 * Test files mock both `@/db` and `@/db/pool` with the same instance, which
 * matches production behavior closely enough for these tests: both drivers
 * point at one database, and PGlite supports real transactions.
 */
export function getTestDb(): Promise<TestDb> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const client = new PGlite();
      const db = drizzle(client, { schema });
      const { pushSchema } = await import("drizzle-kit/api");
      const { apply } = await pushSchema(
        schema,
        db as unknown as Parameters<typeof pushSchema>[1],
      );
      await apply();
      return db;
    })();
  }
  return instancePromise;
}
