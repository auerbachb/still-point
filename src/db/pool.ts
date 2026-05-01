import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

export type PoolDb = NeonDatabase<typeof schema>;

const globalForPool = globalThis as typeof globalThis & {
  __drizzlePool?: Pool;
  __poolDb?: PoolDb;
};

function getPool(): Pool {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  if (!globalForPool.__drizzlePool) {
    globalForPool.__drizzlePool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForPool.__drizzlePool;
}

function getPoolDb(): PoolDb {
  if (!globalForPool.__poolDb) {
    globalForPool.__poolDb = drizzle(getPool(), { schema });
  }
  return globalForPool.__poolDb;
}

/**
 * WebSocket-backed Drizzle client — use **only** for `db.transaction()` (Neon HTTP
 * driver does not support interactive transactions). All other routes should use
 * `@/db` (HTTP) for reliable connections on Vercel serverless.
 */
export const poolDb = new Proxy({} as PoolDb, {
  get(_, prop) {
    return (getPoolDb() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});

/** End WebSocket pool (scripts / Playwright globalSetup only; not used in serverless). */
export async function closePoolDb(): Promise<void> {
  if (globalForPool.__drizzlePool) {
    await globalForPool.__drizzlePool.end();
    globalForPool.__drizzlePool = undefined;
    globalForPool.__poolDb = undefined;
  }
}
