/**
 * Issue #835 (focus activity tracking 1/5, #765): `userCompletedSessionOnDate`
 * answers "did this user meditate on this day?" for the daily reminder and the
 * missed-day decisions in `notification-scheduler.ts`. A focus session (reading,
 * writing, listening) is not meditation, so it must not count; quick, breath and
 * standard sits keep counting. Runs against a real in-process Postgres (PGlite).
 *
 * Issue #890 (combine today's sits 1/5, #769): `previousPracticeDayStillOpen`
 * treats a completed combined sit as closing both of a two-a-day day's tracks.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { previousPracticeDayStillOpen, userCompletedSessionOnDate } from "./daily-reminder";

const DAY = "2026-10-26";

let db: TestDb;
let seq = 0;

async function makeUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `remind835-${seq}@test.local`, username: `remind835_${seq}`, ...overrides })
    .returning({ id: users.id });
  return row!.id;
}

async function insertSession(
  userId: string,
  sessionType: string,
  overrides: Partial<typeof sessions.$inferInsert> = {},
): Promise<void> {
  await db.insert(sessions).values({
    userId,
    dayNumber: 1,
    sessionType,
    duration: 60,
    completed: true,
    actualTime: 60,
    clearPercent: 90,
    thoughtCount: 0,
    sessionDate: DAY,
    ...overrides,
  });
}

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("userCompletedSessionOnDate ignores focus sessions (#835)", () => {
  test("is false for a day whose only completed session is a focus session", async () => {
    const userId = await makeUser();
    await insertSession(userId, "focus");

    expect(await userCompletedSessionOnDate(userId, DAY)).toBe(false);
  });

  test.each(["quick", "breath", "standard"])(
    "is true once a completed %s session exists that day",
    async (sessionType) => {
      const userId = await makeUser();
      await insertSession(userId, "focus");
      expect(await userCompletedSessionOnDate(userId, DAY)).toBe(false);

      await insertSession(userId, sessionType);

      expect(await userCompletedSessionOnDate(userId, DAY)).toBe(true);
    },
  );

  test("an ended-early standard sit still does not count, focus session or not", async () => {
    const userId = await makeUser();
    await insertSession(userId, "focus");
    await insertSession(userId, "standard", { completed: false });

    expect(await userCompletedSessionOnDate(userId, DAY)).toBe(false);
  });

  test("a completed sit on another day does not count for this one", async () => {
    const userId = await makeUser();
    await insertSession(userId, "focus");
    await insertSession(userId, "standard", { sessionDate: "2026-10-25" });

    expect(await userCompletedSessionOnDate(userId, DAY)).toBe(false);
    expect(await userCompletedSessionOnDate(userId, "2026-10-25")).toBe(true);
  });
});

describe("previousPracticeDayStillOpen counts a combined sit for both tracks (#890)", () => {
  test("a two-a-day day whose only sit is a completed combined one is closed", async () => {
    const userId = await makeUser({ dualTrackEnabled: true });
    await insertSession(userId, "standard", { track: "primary", combined: true });

    expect(await previousPracticeDayStillOpen(userId, DAY)).toBe(false);
  });

  test("a two-a-day day with only a plain primary sit is still open", async () => {
    const userId = await makeUser({ dualTrackEnabled: true });
    await insertSession(userId, "standard", { track: "primary" });

    expect(await previousPracticeDayStillOpen(userId, DAY)).toBe(true);
  });

  test("an ended-early combined sit leaves a two-a-day day open", async () => {
    const userId = await makeUser({ dualTrackEnabled: true });
    await insertSession(userId, "standard", { track: "primary", combined: true, completed: false });

    expect(await previousPracticeDayStillOpen(userId, DAY)).toBe(true);
  });

  test("a combined sit closes a single-track day, as any primary sit does", async () => {
    const userId = await makeUser({ dualTrackEnabled: false });
    await insertSession(userId, "standard", { track: "primary", combined: true });

    expect(await previousPracticeDayStillOpen(userId, DAY)).toBe(false);
  });
});
