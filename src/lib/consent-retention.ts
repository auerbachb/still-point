import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * TCPA consent proof is kept for the relationship plus five years (#674): a
 * `(user_id, channel)` group of `consent_events` becomes purgeable five years
 * after the revocation that ended it (#789).
 */
export const CONSENT_RETENTION_YEARS = 5;

export type ConsentRetentionPurgeResult = {
  /** A group was eligible only if its latest event is strictly before this instant. */
  cutoff: Date;
  /** Rows this run deleted. */
  deletedEvents: number;
  /** Distinct `(user_id, channel)` groups those rows belonged to. */
  purgedGroups: number;
};

/**
 * `now` minus CONSENT_RETENTION_YEARS calendar years, in UTC. Feb 29 has no
 * counterpart five years back, so it clamps to Feb 28 instead of rolling forward
 * to Mar 1 — a leap-day run never purges an event younger than five years.
 */
export function consentRetentionCutoff(now: Date): Date {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("consentRetentionCutoff: invalid reference time");
  }
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(now.getUTCFullYear() - CONSENT_RETENTION_YEARS);
  if (cutoff.getUTCMonth() !== now.getUTCMonth()) {
    // Day 0 of the month it rolled into is the last day of the intended month.
    cutoff.setUTCDate(0);
  }
  return cutoff;
}

/**
 * Deletes every row of each `(user_id, channel)` group whose latest event is a
 * `revoked` strictly older than the cutoff. A newer event of either kind keeps
 * the whole group. A group whose latest event is `granted` is consent still in
 * force (opt-out always appends `revoked` in the statement that clears the
 * opt-in), so it stays while the account exists — as does a tie, where the
 * latest instant holds both a grant and a revocation.
 *
 * One statement, so it is atomic on the Neon HTTP driver (see src/db/atomic.ts).
 * A rerun deletes nothing new and an overlapping run skips rows already gone.
 * The DELETE reads one snapshot: a grant that commits mid-statement for a group
 * being purged survives, while that group's older rows — from a relationship
 * that ended more than five years earlier — are deleted.
 */
export async function purgeExpiredConsentEvents(
  options: { now?: Date } = {},
): Promise<ConsentRetentionPurgeResult> {
  const cutoff = consentRetentionCutoff(options.now ?? new Date());

  const result = await db.execute(sql`
    with expired as (
      select user_id, channel
      from consent_events
      group by user_id, channel
      having max(created_at) < ${cutoff}
        and max(created_at) filter (where event = 'revoked') = max(created_at)
        and max(created_at) filter (where event = 'granted') is distinct from max(created_at)
    ),
    deleted as (
      delete from consent_events ce
      using expired e
      where ce.user_id = e.user_id
        and ce.channel = e.channel
      returning ce.user_id, ce.channel
    )
    select
      (select count(*)::int from deleted) as deleted_events,
      (select count(*)::int from (select distinct user_id, channel from deleted) as g) as purged_groups
  `);

  // Scalar subqueries always yield one row; a missing one is a driver fault, not
  // "nothing purged".
  const row = result.rows[0];
  if (!row) {
    throw new Error("CONSENT_PURGE_NO_RESULT");
  }
  return {
    cutoff,
    deletedEvents: Number(row.deleted_events),
    purgedGroups: Number(row.purged_groups),
  };
}
