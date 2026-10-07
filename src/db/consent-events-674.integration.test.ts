/**
 * Issue #674 — backfill existing call_consent_at values into consent_events,
 * and confirm account deletion (DELETE FROM users) cascades those rows away.
 */
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const migrationSql = fs.readFileSync(
  path.join(process.cwd(), "drizzle/notification_preferences_consent_events_674_incremental.sql"),
  "utf8",
);

const userWithConsent = "11111111-1111-4111-8111-111111111111";
const userWithoutConsent = "22222222-2222-4222-8222-222222222222";

describe("consent_events migration (#674)", () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  test("backfills a granted event and removes it when the user is deleted", async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE notification_preferences (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        call_phone_number varchar(20),
        call_consent_at timestamptz
      );
    `);
    await pg.query(`INSERT INTO users (id) VALUES ($1), ($2)`, [
      userWithConsent,
      userWithoutConsent,
    ]);
    await pg.query(
      `INSERT INTO notification_preferences (user_id, call_phone_number, call_consent_at)
       VALUES ($1, $2, $3), ($4, NULL, NULL)`,
      [userWithConsent, "+15551234567", "2026-05-29T12:00:00.000Z", userWithoutConsent],
    );

    await pg.exec(migrationSql);
    await pg.exec(migrationSql);

    const events = await pg.query<{
      user_id: string;
      channel: string;
      phone_number: string | null;
      event: string;
      disclosure_version: string | null;
      created_at: Date | string;
    }>(
      `SELECT user_id, channel, phone_number, event, disclosure_version, created_at
       FROM consent_events
       ORDER BY created_at`,
    );

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      user_id: userWithConsent,
      channel: "call",
      phone_number: null,
      event: "granted",
      disclosure_version: null,
    });
    expect(new Date(events.rows[0]!.created_at).toISOString()).toBe("2026-05-29T12:00:00.000Z");

    await pg.query(`DELETE FROM users WHERE id = $1`, [userWithConsent]);
    const remaining = await pg.query<{ n: number | string }>(
      `SELECT count(*)::int AS n FROM consent_events`,
    );
    expect(Number(remaining.rows[0]?.n)).toBe(0);
  });
});
