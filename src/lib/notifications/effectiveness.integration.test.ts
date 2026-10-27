/**
 * Issue #675: the nudge effectiveness report against seeded PGlite data with known
 * outcomes. The two nudged users live in Los Angeles (UTC-7 in October) and Tokyo
 * (UTC+9), so a row's window_key date differs from the UTC date of its timestamp.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { callAttempts, notificationDispatches, sessions, users } from "@/db/schema";
import { addDaysToIsoDate } from "@/lib/sessionCalendar";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

vi.mock("@/db", async () => ({ db: await getTestDb() }));

import { userCompletedSessionOnDate } from "./daily-reminder";
import {
  ALL_NUDGES,
  buildNudgeEffectivenessReport,
  CALL_NUDGE,
  formatNudgeEffectivenessMarkdown,
  loadNudgeEffectivenessInput,
  resolveReportWindow,
  type NudgeEffectivenessReport,
} from "./effectiveness";

const reportWindow = resolveReportWindow({ days: 7, end: "2026-10-07" });

let db: TestDb;
let la: string;
let tokyo: string;
let quiet: string;
let report: NudgeEffectivenessReport;

async function makeUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `nudge675-${name}@test.local`,
      username: `nudge675_${name}`,
      createdAt: new Date("2026-09-01T00:00:00Z"),
    })
    .returning();
  return row!.id;
}

async function dispatch(userId: string, notificationType: string, windowKey: string, sentAt: string) {
  await db.insert(notificationDispatches).values({
    userId,
    notificationType,
    windowKey,
    sentAt: new Date(sentAt),
  });
}

async function callAttempt(userId: string, windowKey: string, status: "initiated" | "failed", createdAt: string) {
  await db.insert(callAttempts).values({
    userId,
    phoneNumber: "+15555550100",
    windowKey,
    status,
    createdAt: new Date(createdAt),
  });
}

async function sit(userId: string, sessionDate: string, savedAt: string, completed = true, sessionType = "standard") {
  await db.insert(sessions).values({
    userId,
    dayNumber: 1,
    sessionType,
    track: "primary",
    duration: 60,
    completed,
    actualTime: 60,
    clearPercent: 90,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate,
    createdAt: new Date(savedAt),
  });
}

function rowFor(nudge: string) {
  const row = report.rows.find((candidate) => candidate.nudge === nudge);
  if (!row) throw new Error(`no row for ${nudge}`);
  return row;
}

beforeAll(async () => {
  db = await getTestDb();
  la = await makeUser("la");
  tokyo = await makeUser("tokyo");
  quiet = await makeUser("quiet");

  // Los Angeles. Reminders go out at 21:00 local, 04:00 UTC the next day.
  await dispatch(la, "daily_reminder", "2026-09-30", "2026-10-01T04:00:00Z"); // UTC date in the window, local day is not
  await dispatch(la, "daily_reminder", "2026-10-05", "2026-10-06T04:00:00Z");
  await dispatch(la, "daily_reminder", "2026-10-07", "2026-10-08T04:00:00Z"); // UTC date past the window, local day is in it
  await dispatch(la, "daily_reminder", "2026-10-08", "2026-10-09T04:00:00Z");
  await dispatch(la, "daily_reminder", "bogus", "2026-10-03T12:00:00Z");
  await sit(la, "2026-09-30", "2026-10-01T05:00:00Z");
  await sit(la, "2026-10-05", "2026-10-06T05:30:00Z"); // 22:30 local: converts the 10-05 reminder
  await sit(la, "2026-10-06", "2026-10-06T16:00:00Z"); // next local day, so it must not
  await sit(la, "2026-10-07", "2026-10-08T05:00:00Z", false); // not completed
  await sit(la, "2026-10-07", "2026-10-08T06:00:00Z", true, "focus"); // a focus session is not a sit (#835)

  // Tokyo.
  await dispatch(tokyo, "miss_a_day", "2026-10-01", "2026-09-30T23:30:00Z"); // 08:30 local on 10-01
  await sit(tokyo, "2026-10-01", "2026-10-01T00:15:00Z");
  await dispatch(tokyo, "failure_reason_reminder", "2026-10-02", "2026-10-02T11:00:00Z"); // 20:00 local
  await sit(tokyo, "2026-10-02", "2026-10-02T03:00:00Z"); // noon local, before the reminder
  // Two placed calls and their ledger claims, then a sit after them.
  await dispatch(tokyo, CALL_NUDGE, "2026-10-03T19", "2026-10-03T10:00:00Z");
  await callAttempt(tokyo, "2026-10-03T19", "initiated", "2026-10-03T10:00:05Z");
  await dispatch(tokyo, CALL_NUDGE, "2026-10-03T20", "2026-10-03T11:00:00Z");
  await callAttempt(tokyo, "2026-10-03T20", "initiated", "2026-10-03T11:00:05Z");
  await sit(tokyo, "2026-10-03", "2026-10-03T11:30:00Z");
  // Vapi rejected this one, and the ledger claim stays anyway.
  await dispatch(tokyo, CALL_NUDGE, "2026-10-04T19", "2026-10-04T10:00:00Z");
  await callAttempt(tokyo, "2026-10-04T19", "failed", "2026-10-04T10:00:05Z");
  // Weekly reminder: ISO week 41 of 2026 starts Monday 10-05.
  await dispatch(tokyo, "daily_reminder", "2026-W41", "2026-10-05T00:00:00Z");

  // Sits every day and was never nudged.
  for (let day = reportWindow.start; day <= reportWindow.end; day = addDaysToIsoDate(day, 1)) {
    await sit(quiet, day, `${day}T12:00:00Z`);
  }

  report = await buildNudgeEffectivenessReport(reportWindow, new Date("2026-10-26T12:00:00Z"));
});

afterAll(async () => {
  await closeTestDb();
});

describe("nudge effectiveness report against seeded data (#675)", () => {
  test("dates each row by its window_key, the user's local day, not the UTC timestamp", async () => {
    const input = await loadNudgeEffectivenessInput(reportWindow);
    const datesFor = (userId: string) =>
      input.sends.filter((send) => send.userId === userId).map((send) => send.localDate).sort();

    expect(datesFor(la)).toEqual(["2026-10-05", "2026-10-07"]);
    expect(datesFor(tokyo)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-03", "2026-10-05"]);
    expect(input.unparsedWindowKeys).toBe(1);
  });

  test("reports each push type's conversion and baseline", () => {
    expect(rowFor("daily_reminder")).toMatchObject({
      sent: 3,
      users: 2,
      nudgedDays: 3,
      conversion: { count: 1, total: 3 },
      nudgedDaySits: { count: 1, total: 3 },
      // LA: 10-01..04 and 10-06, with a sit on 06. Tokyo: 10-04, 06, 07, no sits.
      unnudgedDaySits: { count: 1, total: 8 },
    });
    expect(rowFor("miss_a_day")).toMatchObject({
      sent: 1,
      conversion: { count: 1, total: 1 },
      unnudgedDaySits: { count: 0, total: 3 },
    });
    expect(rowFor("failure_reason_reminder")).toMatchObject({
      sent: 1,
      conversion: { count: 0, total: 1 },
      nudgedDaySits: { count: 1, total: 1 },
    });
  });

  test("measures the call channel from call_attempts, not the ledger", () => {
    expect(rowFor(CALL_NUDGE)).toMatchObject({
      source: "call_attempts",
      sent: 2,
      users: 1,
      nudgedDays: 1,
      conversion: { count: 1, total: 1 },
    });
    expect(report.unplacedCalls).toMatchObject({ attempts: 1, days: 1, conversion: { count: 0, total: 1 } });
    expect(report.unmeasuredLedgerRows).toEqual({ [CALL_NUDGE]: 3 });
  });

  test("excludes users with zero dispatches instead of counting them as zeroes", async () => {
    const input = await loadNudgeEffectivenessInput(reportWindow);
    expect(new Set(input.sits.map((completed) => completed.userId))).toEqual(new Set([la, tokyo]));
    expect(rowFor(ALL_NUDGES)).toMatchObject({
      sent: 7,
      users: 2,
      nudgedDays: 6,
      conversion: { count: 3, total: 6 },
      nudgedDaySits: { count: 4, total: 6 },
      unnudgedDaySits: { count: 1, total: 8 },
    });
  });

  test("loads the same sits userCompletedSessionOnDate() sees, on every user-day", async () => {
    const input = await loadNudgeEffectivenessInput(reportWindow);
    for (const userId of [la, tokyo]) {
      for (let day = reportWindow.start; day <= reportWindow.end; day = addDaysToIsoDate(day, 1)) {
        const loaded = input.sits.some((completed) => completed.userId === userId && completed.sessionDate === day);
        expect(loaded, `${userId} on ${day}`).toBe(await userCompletedSessionOnDate(userId, day));
      }
    }
  });

  test("prints no user ids, emails, or usernames", () => {
    const markdown = formatNudgeEffectivenessMarkdown(report);
    for (const id of [la, tokyo, quiet]) {
      expect(markdown).not.toContain(id);
    }
    expect(markdown).not.toMatch(/nudge675/);
  });
});
