/**
 * Issue #789 — five-year retention purge of `consent_events`.
 *
 * Runs `purgeExpiredConsentEvents` against a real in-process Postgres (PGlite)
 * built from `src/db/schema.ts`. Every event carries an explicit `created_at`
 * relative to a fixed reference time, and the purge receives that same time:
 * Vitest fake timers would not move Postgres's clock.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { consentEvents, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { consentRetentionCutoff, purgeExpiredConsentEvents } from "./consent-retention";

/** Reference run time; five years earlier is the cutoff. */
const NOW = new Date("2031-06-15T12:00:00.000Z");
const CUTOFF = "2026-06-15T12:00:00.000Z";

let db: TestDb;
let seq = 0;

async function makeUser(label: string): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `${label}-${seq}@test.local`, username: `${label}_${seq}` })
    .returning({ id: users.id });
  return row!.id;
}

async function addEvent(
  userId: string,
  channel: "call" | "sms",
  event: "granted" | "revoked",
  createdAt: string,
): Promise<string> {
  const [row] = await db
    .insert(consentEvents)
    .values({ userId, channel, event, method: "preferences_api", createdAt: new Date(createdAt) })
    .returning({ id: consentEvents.id });
  return row!.id;
}

async function remainingIds(): Promise<string[]> {
  const rows = await db.select({ id: consentEvents.id }).from(consentEvents);
  return rows.map((row) => row.id).sort();
}

beforeAll(async () => {
  db = await getTestDb();
});

beforeEach(async () => {
  await db.delete(consentEvents);
  await db.delete(users);
});

afterAll(async () => {
  await closeTestDb();
});

describe("purgeExpiredConsentEvents (#789)", () => {
  test("deletes only groups whose latest event is a revocation older than five years", async () => {
    const expiredUser = await makeUser("expired");
    const mixedUser = await makeUser("mixed");
    const boundaryUser = await makeUser("boundary");
    const justExpiredUser = await makeUser("justexpired");
    const recentUser = await makeUser("recent");
    const splitUser = await makeUser("split");

    // Every event is long past the cutoff: the whole group goes.
    const expired = [
      await addEvent(expiredUser, "call", "granted", "2019-03-01T09:00:00.000Z"),
      await addEvent(expiredUser, "call", "revoked", "2024-08-20T18:30:00.000Z"),
    ];
    // Old history, but a later event is inside the window: every row stays.
    const mixed = [
      await addEvent(mixedUser, "call", "granted", "2018-05-01T00:00:00.000Z"),
      await addEvent(mixedUser, "call", "revoked", "2019-05-01T00:00:00.000Z"),
      await addEvent(mixedUser, "call", "revoked", "2029-02-14T10:00:00.000Z"),
    ];
    // Latest event exactly at the cutoff is not "more than five years" old.
    const boundary = [
      await addEvent(boundaryUser, "call", "granted", "2021-01-01T00:00:00.000Z"),
      await addEvent(boundaryUser, "call", "revoked", CUTOFF),
    ];
    // One millisecond earlier is.
    const justExpired = [
      await addEvent(justExpiredUser, "call", "granted", "2021-01-01T00:00:00.000Z"),
      await addEvent(justExpiredUser, "call", "revoked", "2026-06-15T11:59:59.999Z"),
    ];
    // Entirely inside the window.
    const recent = [
      await addEvent(recentUser, "call", "granted", "2028-03-03T08:00:00.000Z"),
      await addEvent(recentUser, "call", "revoked", "2030-10-10T20:00:00.000Z"),
    ];
    // Same user: the expired call group goes, the in-window sms group stays.
    const splitCall = [
      await addEvent(splitUser, "call", "granted", "2020-02-02T00:00:00.000Z"),
      await addEvent(splitUser, "call", "revoked", "2023-03-03T00:00:00.000Z"),
    ];
    const splitSms = [
      await addEvent(splitUser, "sms", "granted", "2022-01-01T00:00:00.000Z"),
      await addEvent(splitUser, "sms", "revoked", "2029-09-09T00:00:00.000Z"),
    ];

    const result = await purgeExpiredConsentEvents({ now: NOW });

    expect(result.cutoff.toISOString()).toBe(CUTOFF);
    expect(result.deletedEvents).toBe(expired.length + justExpired.length + splitCall.length);
    expect(result.purgedGroups).toBe(3);
    // `expired`/`justExpired` share the call channel with the kept groups and
    // `splitCall` shares a user with `splitSms`, so the group key must be both.
    expect(await remainingIds()).toEqual(
      [...mixed, ...boundary, ...recent, ...splitSms].sort(),
    );
  });

  test("keeps a group whose latest event is a grant, however old", async () => {
    const grantedUser = await makeUser("granted");
    const regrantedUser = await makeUser("regranted");
    const revokedUser = await makeUser("revoked");

    // Still opted in since 2020: this row is the proof of consent for live calls.
    const granted = await addEvent(grantedUser, "call", "granted", "2020-07-04T15:00:00.000Z");
    // Opted out, then back in: the newest event is a grant, so the history stays.
    const regranted = [
      await addEvent(regrantedUser, "call", "granted", "2019-01-01T00:00:00.000Z"),
      await addEvent(regrantedUser, "call", "revoked", "2020-01-01T00:00:00.000Z"),
      await addEvent(regrantedUser, "call", "granted", "2021-01-01T00:00:00.000Z"),
    ];
    await addEvent(revokedUser, "call", "revoked", "2021-01-01T00:00:00.000Z");

    const result = await purgeExpiredConsentEvents({ now: NOW });

    expect(result).toMatchObject({ deletedEvents: 1, purgedGroups: 1 });
    expect(await remainingIds()).toEqual([granted, ...regranted].sort());
  });

  test("keeps a group whose latest instant holds both a grant and a revocation", async () => {
    const user = await makeUser("tie");
    const tied = [
      await addEvent(user, "call", "granted", "2020-03-03T03:03:03.000Z"),
      await addEvent(user, "call", "revoked", "2020-03-03T03:03:03.000Z"),
    ];

    const result = await purgeExpiredConsentEvents({ now: NOW });

    expect(result).toMatchObject({ deletedEvents: 0, purgedGroups: 0 });
    expect(await remainingIds()).toEqual([...tied].sort());
  });

  test("a second run deletes nothing and leaves the same rows", async () => {
    const expiredUser = await makeUser("rerun_expired");
    const keptUser = await makeUser("rerun_kept");
    await addEvent(expiredUser, "call", "granted", "2019-03-01T00:00:00.000Z");
    await addEvent(expiredUser, "call", "revoked", "2022-03-01T00:00:00.000Z");
    const kept = await addEvent(keptUser, "call", "revoked", "2030-01-01T00:00:00.000Z");

    const first = await purgeExpiredConsentEvents({ now: NOW });
    const second = await purgeExpiredConsentEvents({ now: NOW });

    expect(first).toMatchObject({ deletedEvents: 2, purgedGroups: 1 });
    expect(second).toMatchObject({ deletedEvents: 0, purgedGroups: 0 });
    expect(second.cutoff.toISOString()).toBe(CUTOFF);
    expect(await remainingIds()).toEqual([kept]);
  });

  test("defaults the reference time to now", async () => {
    const user = await makeUser("default_now");
    const sixYearsMs = 6 * 365 * 24 * 60 * 60 * 1000;
    const before = Date.now();
    await addEvent(user, "call", "granted", new Date(before - sixYearsMs - 1000).toISOString());
    await addEvent(user, "call", "revoked", new Date(before - sixYearsMs).toISOString());
    const otherUser = await makeUser("default_now_recent");
    const recent = await addEvent(
      otherUser,
      "call",
      "revoked",
      new Date(before - 24 * 60 * 60 * 1000).toISOString(),
    );

    const result = await purgeExpiredConsentEvents();
    const after = Date.now();

    expect(result.cutoff.getTime()).toBeGreaterThanOrEqual(
      consentRetentionCutoff(new Date(before)).getTime(),
    );
    expect(result.cutoff.getTime()).toBeLessThanOrEqual(
      consentRetentionCutoff(new Date(after)).getTime(),
    );
    expect(result).toMatchObject({ deletedEvents: 2, purgedGroups: 1 });
    expect(await remainingIds()).toEqual([recent]);
  });
});
