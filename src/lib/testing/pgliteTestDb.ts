import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

export type TestDb = PgliteDatabase<typeof schema>;

let instancePromise: Promise<TestDb> | null = null;
let client: PGlite | null = null;

/**
 * In-process Postgres (PGlite) wired to the app's Drizzle schema, for
 * route-level integration tests. The schema is created with drizzle-kit's
 * `pushSchema`, so tests always run against exactly what `src/db/schema.ts`
 * declares (the numbered drizzle/*.sql snapshot can lag behind — see
 * scripts/apply-migrations.ts).
 *
 * Test files mock `@/db` with the PGlite instance. PGlite supports real
 * transactions and `db.execute`, so atomic CTE helpers run against the same
 * schema the app uses in production (via Neon HTTP).
 *
 * The instance is cached per module registry (one per Vitest test file under
 * the default isolation). Call `closeTestDb()` in `afterAll` so reruns in the
 * same worker never see leftover rows.
 */
export function getTestDb(): Promise<TestDb> {
  if (!instancePromise) {
    instancePromise = (async () => {
      let pglite: PGlite | null = null;
      try {
        pglite = new PGlite();
        const db = drizzle(pglite, { schema });
        const { pushSchema } = await import("drizzle-kit/api");
        const { apply } = await pushSchema(
          schema,
          db as unknown as Parameters<typeof pushSchema>[1],
        );
        await apply();
        client = pglite;
        return db;
      } catch (error) {
        // Free the in-memory database if schema setup failed after creation,
        // and don't cache a rejected promise — let the next call retry.
        await pglite?.close().catch(() => {});
        instancePromise = null;
        throw error;
      }
    })();
  }
  return instancePromise;
}

/** Tear down the cached database so the next `getTestDb()` starts fresh. */
export async function closeTestDb(): Promise<void> {
  const pending = instancePromise;
  instancePromise = null;
  if (pending) {
    try {
      await pending;
    } catch {
      // Initialization failed; there is nothing to close.
    }
  }
  await client?.close();
  client = null;
}
