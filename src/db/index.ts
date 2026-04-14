import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

type AppDb = NeonDatabase<typeof schema>;

const globalForDb = globalThis as typeof globalThis & {
  __drizzlePool?: Pool;
  __drizzleDb?: AppDb;
};

function getPool(): Pool {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  if (!globalForDb.__drizzlePool) {
    globalForDb.__drizzlePool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForDb.__drizzlePool;
}

function getDb(): AppDb {
  if (!globalForDb.__drizzleDb) {
    globalForDb.__drizzleDb = drizzle(getPool(), { schema });
  }
  return globalForDb.__drizzleDb;
}

/** Neon serverless Pool (WebSocket) so `db.transaction()` works — not `neon-http`. */
export const db = new Proxy({} as AppDb, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});
