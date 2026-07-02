import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type AppDb = NeonHttpDatabase<typeof schema>;

const globalForHttp = globalThis as typeof globalThis & {
  __neonSql?: ReturnType<typeof neon>;
  __httpDb?: AppDb;
};

function getSql() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set");
  }
  if (!globalForHttp.__neonSql) {
    globalForHttp.__neonSql = neon(url);
  }
  return globalForHttp.__neonSql;
}

function getDb(): AppDb {
  if (!globalForHttp.__httpDb) {
    globalForHttp.__httpDb = drizzle(getSql(), { schema });
  }
  return globalForHttp.__httpDb;
}

/** Neon HTTP driver — reliable on Vercel / Next.js 15 serverless. */
export const db = new Proxy({} as AppDb, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop as string];
  },
});
