/**
 * Issue #147 — at most one host row per buddy session.
 *
 * Two layers of coverage:
 *  1. The schema-derived partial unique index (PGlite builds the DB from
 *     `src/db/schema.ts` via drizzle-kit `pushSchema`), exercised through the
 *     real create/join shapes: one host + many guests is fine, a second host
 *     row for the same session is rejected, and distinct sessions each keep
 *     their own host.
 *  2. The deployed migration artifact
 *     (`drizzle/buddy_session_participants_one_host_per_session_incremental.sql`)
 *     applied with raw SQL to confirm it is valid, idempotent, enforces the
 *     invariant, and that the issue's read-only precheck query reports
 *     violations.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { buddySessionParticipants, buddySessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

let db: TestDb;
let seq = 0;
let hostUserId: string;
let guestUserId: string;
let buddySessionId: string;

async function makeUser(label: string, currentDay = 1): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${label}-${seq}@test.local`,
      username: `${label}_${seq}`,
      currentDay,
    })
    .returning({ id: users.id });
  return row!.id;
}

async function makeSession(host: string): Promise<string> {
  const [row] = await db
    .insert(buddySessions)
    .values({
      shareToken: `tok-147-${seq}-${Math.random().toString(36).slice(2)}`,
      hostUserId: host,
      state: "waiting",
      durationSeconds: 60,
    })
    .returning({ id: buddySessions.id });
  return row!.id;
}

/** The PGlite instance is cached across the file, so clear the tables each test. */
async function resetTables(): Promise<void> {
  await db.delete(buddySessionParticipants);
  await db.delete(buddySessions);
  await db.delete(users);
}

beforeEach(async () => {
  db = await getTestDb();
  await resetTables();
  seq += 1;
  hostUserId = await makeUser("host147");
  guestUserId = await makeUser("guest147", 5);
  buddySessionId = await makeSession(hostUserId);
});

afterAll(async () => {
  await closeTestDb();
});

describe("schema partial unique index — one host per buddy session", () => {
  test("create (host) + join (guest) coexist for the same session", async () => {
    await db.insert(buddySessionParticipants).values({
      buddySessionId,
      userId: hostUserId,
      isHost: true,
    });
    await db.insert(buddySessionParticipants).values({
      buddySessionId,
      userId: guestUserId,
      isHost: false,
    });

    const rows = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.buddySessionId, buddySessionId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isHost)).toHaveLength(1);
  });

  test("a second host row for the same session is rejected", async () => {
    await db.insert(buddySessionParticipants).values({
      buddySessionId,
      userId: hostUserId,
      isHost: true,
    });

    let caught: unknown;
    try {
      await db.insert(buddySessionParticipants).values({
        buddySessionId,
        userId: guestUserId,
        isHost: true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // Drizzle wraps the driver error; the constraint name lives on the cause.
    const message = `${(caught as Error)?.message ?? ""} ${
      ((caught as { cause?: Error })?.cause?.message) ?? ""
    }`;
    expect(message).toContain("buddy_session_participants_one_host_per_session");

    // The original host row survives; the duplicate never lands.
    const hosts = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.buddySessionId, buddySessionId));
    expect(hosts.filter((r) => r.isHost)).toHaveLength(1);
  });

  test("two different sessions can each have their own host", async () => {
    const otherSessionId = await makeSession(guestUserId);
    await db.insert(buddySessionParticipants).values({
      buddySessionId,
      userId: hostUserId,
      isHost: true,
    });
    await db.insert(buddySessionParticipants).values({
      buddySessionId: otherSessionId,
      userId: guestUserId,
      isHost: true,
    });

    const hosts = await db
      .select()
      .from(buddySessionParticipants)
      .where(eq(buddySessionParticipants.isHost, true));
    expect(hosts).toHaveLength(2);
  });
});

describe("migration artifact — buddy_session_participants_one_host_per_session_incremental.sql", () => {
  const migrationSql = readFileSync(
    path.join(
      process.cwd(),
      "drizzle",
      "buddy_session_participants_one_host_per_session_incremental.sql",
    ),
    "utf8",
  );

  // The precheck documented in the migration header (and specified by the issue):
  // drives from buddy_sessions with a LEFT JOIN so sessions with zero participant
  // rows are also surfaced (a participant-only GROUP BY would miss them).
  const PRECHECK_SQL = `SELECT s.id AS buddy_session_id,
      count(p.id) FILTER (WHERE p.is_host) AS hosts
    FROM buddy_sessions s
    LEFT JOIN buddy_session_participants p ON p.buddy_session_id = s.id
    GROUP BY s.id
    HAVING count(p.id) FILTER (WHERE p.is_host) <> 1`;

  // Alias kept for test readability: both queries are now equivalent (same LEFT JOIN shape).
  const COMPLETE_AUDIT_SQL = PRECHECK_SQL;

  async function freshTable(): Promise<PGlite> {
    const pg = new PGlite();
    await pg.exec(`
      CREATE TABLE buddy_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
      CREATE TABLE buddy_session_participants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        buddy_session_id uuid NOT NULL,
        user_id uuid NOT NULL,
        is_host boolean NOT NULL DEFAULT false
      );
    `);
    return pg;
  }

  test("precheck query flags a session with two hosts before the index exists", async () => {
    const pg = await freshTable();
    try {
      const s = "11111111-1111-1111-1111-111111111111";
      await pg.exec(`INSERT INTO buddy_sessions (id) VALUES ('${s}');`);
      await pg.exec(
        `INSERT INTO buddy_session_participants (buddy_session_id, user_id, is_host) VALUES
          ('${s}', gen_random_uuid(), true),
          ('${s}', gen_random_uuid(), true);`,
      );
      const res = await pg.query<{ buddy_session_id: string; hosts: number }>(PRECHECK_SQL);
      expect(res.rows).toHaveLength(1);
      expect(Number(res.rows[0]!.hosts)).toBe(2);
    } finally {
      await pg.close();
    }
  });

  test("precheck (LEFT JOIN) flags a zero-participant session that a participant-only query would miss", async () => {
    const pg = await freshTable();
    try {
      const empty = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
      const healthy = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
      await pg.exec(`INSERT INTO buddy_sessions (id) VALUES ('${empty}'), ('${healthy}');`);
      // Healthy session: exactly one host. Empty session: no participant rows at all.
      await pg.exec(
        `INSERT INTO buddy_session_participants (buddy_session_id, user_id, is_host)
         VALUES ('${healthy}', gen_random_uuid(), true);`,
      );

      // The LEFT JOIN precheck catches the empty (0-host) session, leaves the healthy one alone.
      const precheck = await pg.query<{ buddy_session_id: string; hosts: number }>(PRECHECK_SQL);
      expect(precheck.rows).toHaveLength(1);
      expect(precheck.rows[0]!.buddy_session_id).toBe(empty);
      expect(Number(precheck.rows[0]!.hosts)).toBe(0);

      // COMPLETE_AUDIT_SQL is now the same shape; same result.
      const audit = await pg.query<{ buddy_session_id: string; hosts: number }>(COMPLETE_AUDIT_SQL);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]!.buddy_session_id).toBe(empty);
      expect(Number(audit.rows[0]!.hosts)).toBe(0);
    } finally {
      await pg.close();
    }
  });

  test("migration builds the index, is idempotent, and rejects a second host", async () => {
    const pg = await freshTable();
    try {
      await pg.exec(migrationSql);
      // Idempotent: re-applying the IF NOT EXISTS migration is a no-op.
      await pg.exec(migrationSql);

      const s = "22222222-2222-2222-2222-222222222222";
      await pg.exec(`INSERT INTO buddy_sessions (id) VALUES ('${s}');`);
      await pg.exec(
        `INSERT INTO buddy_session_participants (buddy_session_id, user_id, is_host)
         VALUES ('${s}', gen_random_uuid(), true);`,
      );
      // A non-host guest is unaffected by the partial index.
      await pg.exec(
        `INSERT INTO buddy_session_participants (buddy_session_id, user_id, is_host)
         VALUES ('${s}', gen_random_uuid(), false);`,
      );

      await expect(
        pg.exec(
          `INSERT INTO buddy_session_participants (buddy_session_id, user_id, is_host)
           VALUES ('${s}', gen_random_uuid(), true);`,
        ),
      ).rejects.toThrow(/buddy_session_participants_one_host_per_session/);

      // With the index in place both audits report the lone-host session as clean.
      const precheck = await pg.query<{ buddy_session_id: string }>(PRECHECK_SQL);
      expect(precheck.rows).toHaveLength(0);
      const audit = await pg.query<{ buddy_session_id: string }>(COMPLETE_AUDIT_SQL);
      expect(audit.rows).toHaveLength(0);
    } finally {
      await pg.close();
    }
  });

  test("migration build fails on pre-existing duplicate hosts (why the precheck is mandatory)", async () => {
    const pg = await freshTable();
    try {
      const s = "33333333-3333-3333-3333-333333333333";
      await pg.exec(`INSERT INTO buddy_sessions (id) VALUES ('${s}');`);
      await pg.exec(
        `INSERT INTO buddy_session_participants (buddy_session_id, user_id, is_host) VALUES
          ('${s}', gen_random_uuid(), true),
          ('${s}', gen_random_uuid(), true);`,
      );
      await expect(pg.exec(migrationSql)).rejects.toThrow();
    } finally {
      await pg.close();
    }
  });
});
