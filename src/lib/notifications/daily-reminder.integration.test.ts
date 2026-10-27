/**
 * Issue #835 (focus activity tracking 1/5, #765): `userCompletedSessionOnDate`
 * answers "did this user meditate on this day?" for the daily reminder and the
 * missed-day decisions in `notification-scheduler.ts`. A focus session (reading,
 * writing, listening) is not meditation, so it must not count; quick, breath and
 * standard sits keep counting. Runs against a real in-process Postgres (PGlite).
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { sessions, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { userCompletedSessionOnDate } from "./daily-reminder";

const DAY = "2026-10-26";

let db: TestDb;
let seq = 0;

async function makeUser(): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `remind835-${seq}@test.local`, username: `remind835_${seq}` })
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
