import { and, eq, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { db } from "@/db";
import { callAttempts, notificationDispatches, sessions, users } from "@/db/schema";
import {
  DAILY_REMINDER_NOTIFICATION_TYPE,
  MISS_A_DAY_NOTIFICATION_TYPE,
} from "@/lib/notifications/daily-reminder";
import { FAILURE_REASON_NOTIFICATION_TYPE } from "@/lib/notifications/failure-reason";
import { addDaysToIsoDate, isValidSessionCalendarDate } from "@/lib/sessionCalendar";

/*
 * Nudge effectiveness (#675). For each nudge type over a trailing window: how
 * often a sit followed the nudge on the same local practice day, plus a baseline
 * of the same users' days with and without a nudge. Read-only. Run it with
 * `npm run report:notification-effectiveness` (docs/notifications.md).
 */

/** Push nudges read from the `notification_dispatches` ledger, in report order. */
export const LEDGER_NUDGE_TYPES = [
  DAILY_REMINDER_NOTIFICATION_TYPE,
  MISS_A_DAY_NOTIFICATION_TYPE,
  FAILURE_REASON_NOTIFICATION_TYPE,
] as const;

/**
 * The missed-sit call (#599). Its sends are `call_attempts` rows, not ledger rows:
 * the scheduler keeps its `missed_sit_call` claim when Vapi rejects the call, so
 * the ledger over-counts calls that actually went out.
 */
export const CALL_NUDGE = "missed_sit_call";

/** Row label for every nudge type together. */
export const ALL_NUDGES = "all";

/** Status `logCallAttempt` records when Vapi accepts a call. */
const PLACED_CALL_STATUS = "initiated";

export const DEFAULT_REPORT_DAYS = 28;
const MAX_REPORT_DAYS = 366;

/**
 * The default window ends two days before today (UTC). Local dates run from 12
 * hours behind UTC to 14 ahead, and a sit before 6:00 local can still be credited
 * to the previous day (GRACE_CUTOFF_HOUR), so yesterday (UTC) may still be open
 * somewhere. The day before it has closed everywhere.
 */
const SETTLED_DAYS_AGO = 2;

/** The furthest local time runs ahead of UTC (UTC+14). */
const MAX_HOURS_AHEAD_OF_UTC = 14;

/**
 * A local practice day is within 14 hours of its UTC date, and a reminder held by
 * quiet hours can go out up to a day after its window_key date. Reading rows this
 * many days either side of the window keeps every row that can date into it.
 */
const SENT_AT_MARGIN_DAYS = 3;

/** Two-sided 95% normal quantile. */
const Z_95 = 1.959964;

export type ReportWindow = {
  /** First local practice day, `YYYY-MM-DD`. */
  start: string;
  /** Last local practice day, inclusive. */
  end: string;
  days: number;
};

/** One nudge that went out, dated to the recipient's local practice day. */
export type NudgeSend = {
  userId: string;
  nudge: string;
  localDate: string;
  sentAt: Date;
};

/** A missed-sit call the scheduler attempted but Vapi did not place. */
export type UnplacedCallAttempt = {
  userId: string;
  localDate: string;
  attemptedAt: Date;
};

/** A completed sit, credited to its local practice day (`sessions.session_date`). */
export type CompletedSit = {
  userId: string;
  sessionDate: string;
  savedAt: Date;
};

export type NudgeEffectivenessInput = {
  window: ReportWindow;
  sends: NudgeSend[];
  unplacedCallAttempts: UnplacedCallAttempt[];
  sits: CompletedSit[];
  /** UTC calendar date of each nudged user's signup. */
  signupDates: Map<string, string>;
  /** In-window ledger rows of types this report does not measure, by type. */
  unmeasuredLedgerRows: Record<string, number>;
  /** Rows near the window whose `window_key` is not a local date. */
  unparsedWindowKeys: number;
};

export type Rate = {
  count: number;
  total: number;
  /** `count / total`, or null when `total` is 0. */
  rate: number | null;
};

export type RateWithInterval = Rate & {
  /** 95% Wilson interval, or null when `total` is 0. */
  interval: { low: number; high: number } | null;
};

export type NudgeEffectivenessRow = {
  nudge: string;
  source: "notification_dispatches" | "call_attempts" | "all";
  sent: number;
  /** Users with at least one send: this row's cohort. */
  users: number;
  /** Distinct user-days with at least one send. */
  nudgedDays: number;
  /** Nudged days on which another kind of nudge also went out. */
  sharedDays: number;
  /** Nudged days with a completed sit saved at or after the day's first send. */
  conversion: RateWithInterval;
  /** Baseline: nudged days with a completed sit at any time that day. */
  nudgedDaySits: Rate;
  /** Baseline: the cohort's days with no nudge of any kind. */
  unnudgedDaySits: Rate;
};

export type NudgeEffectivenessReport = {
  window: ReportWindow;
  generatedAt: string;
  rows: NudgeEffectivenessRow[];
  unplacedCalls: {
    attempts: number;
    /** User-days with an unplaced attempt and no placed call. */
    days: number;
    /** Of those days, the ones with a sit saved at or after the first attempt. */
    conversion: RateWithInterval;
  };
  unmeasuredLedgerRows: Record<string, number>;
  unparsedWindowKeys: number;
};

/** Last local practice day that has closed in every timezone as of `now`. */
export function settledThrough(now: Date): string {
  return addDaysToIsoDate(now.toISOString().slice(0, 10), -SETTLED_DAYS_AGO);
}

/**
 * Latest local practice day that has started somewhere as of `now`. A later day
 * cannot have a nudge or a sit yet, so the baseline would count it as a day
 * without either.
 */
function latestStartedDay(now: Date): string {
  return new Date(now.getTime() + MAX_HOURS_AHEAD_OF_UTC * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function resolveReportWindow(
  options: { days?: number; end?: string } = {},
  now: Date = new Date(),
): ReportWindow {
  const days = options.days ?? DEFAULT_REPORT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_REPORT_DAYS) {
    throw new RangeError(`days must be a whole number from 1 to ${MAX_REPORT_DAYS}, got ${days}`);
  }
  const end = options.end ?? settledThrough(now);
  if (!isValidSessionCalendarDate(end)) {
    throw new RangeError(`end must be a YYYY-MM-DD date, got "${end}"`);
  }
  const latest = latestStartedDay(now);
  if (end > latest) {
    throw new RangeError(`end must be ${latest} or earlier, the last local day that has started anywhere, got "${end}"`);
  }
  return { start: addDaysToIsoDate(end, 1 - days), end, days };
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Hourly call slot, e.g. `2026-05-29T18` (`missedSitCallWindowKey`). */
const SLOT_KEY = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3])$/;
/** Weekly reminder, e.g. `2026-W22`. */
const ISO_WEEK_KEY = /^(\d{4})-W(\d{2})$/;

/** Monday of ISO week 1, the week that contains January 4th. */
function firstIsoMonday(isoYear: number): string {
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const isoWeekday = jan4.getUTCDay() || 7;
  return addDaysToIsoDate(jan4.toISOString().slice(0, 10), 1 - isoWeekday);
}

/** Monday that starts ISO `week` of `isoYear`, or null when that year has no such week. */
export function mondayOfIsoWeek(isoYear: number, week: number): string | null {
  if (week < 1) {
    return null;
  }
  const monday = addDaysToIsoDate(firstIsoMonday(isoYear), (week - 1) * 7);
  // Only some ISO years have a week 53. Past a year's last week we are in next year's week 1.
  return monday < firstIsoMonday(isoYear + 1) ? monday : null;
}

/**
 * The local practice day a `window_key` belongs to. Every key was written in the
 * user's own timezone, so no timestamp is converted here:
 *
 * - `YYYY-MM-DD` (daily reminder, miss-a-day, failure-reason) is the day itself.
 * - `YYYY-MM-DDTHH` (call slot) is the day of that slot.
 * - `YYYY-Www` (weekly daily reminder) is that week's Monday, the only day a weekly
 *   reminder sends (`frequencyAllowsSend`).
 *
 * Returns null for anything else, including a week key on another type.
 */
export function localPracticeDateForWindowKey(nudge: string, windowKey: string): string | null {
  const date = DATE_KEY.test(windowKey) ? windowKey : SLOT_KEY.exec(windowKey)?.[1];
  if (date !== undefined) {
    return isValidSessionCalendarDate(date) ? date : null;
  }
  const week = ISO_WEEK_KEY.exec(windowKey);
  if (week && nudge === DAILY_REMINDER_NOTIFICATION_TYPE) {
    return mondayOfIsoWeek(Number(week[1]), Number(week[2]));
  }
  return null;
}

/** 95% Wilson score interval for `successes` out of `total`. */
export function wilsonInterval(
  successes: number,
  total: number,
): { low: number; high: number } | null {
  if (total === 0) {
    return null;
  }
  const p = successes / total;
  const z2 = Z_95 * Z_95;
  const scale = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / scale;
  const halfWidth = (Z_95 * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / scale;
  return { low: Math.max(0, center - halfWidth), high: Math.min(1, center + halfWidth) };
}

function toRate(count: number, total: number): Rate {
  return { count, total, rate: total === 0 ? null : count / total };
}

function toRateWithInterval(count: number, total: number): RateWithInterval {
  return { ...toRate(count, total), interval: wilsonInterval(count, total) };
}

function sourceOf(nudge: string): NudgeEffectivenessRow["source"] {
  if (nudge === ALL_NUDGES) {
    return "all";
  }
  return nudge === CALL_NUDGE ? "call_attempts" : "notification_dispatches";
}

function dayKey(userId: string, date: string): string {
  return `${userId}|${date}`;
}

function listDays(reportWindow: ReportWindow): string[] {
  const days: string[] = [];
  for (let day = reportWindow.start; day <= reportWindow.end; day = addDaysToIsoDate(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * Pure: turns loaded sends and sits into the report. Events outside the window are
 * ignored, so callers may pass a superset.
 */
export function computeNudgeEffectiveness(
  input: NudgeEffectivenessInput,
  now: Date = new Date(),
): NudgeEffectivenessReport {
  const reportWindow = input.window;
  const inWindow = (date: string) => date >= reportWindow.start && date <= reportWindow.end;
  const sends = input.sends.filter((send) => inWindow(send.localDate));
  const unplaced = input.unplacedCallAttempts.filter((attempt) => inWindow(attempt.localDate));
  const sits = input.sits.filter((sit) => inWindow(sit.sessionDate));

  // A sit at or after the day's first nudge exists exactly when the day's latest sit is.
  const latestSitAt = new Map<string, number>();
  for (const sit of sits) {
    const key = dayKey(sit.userId, sit.sessionDate);
    latestSitAt.set(key, Math.max(latestSitAt.get(key) ?? -Infinity, sit.savedAt.getTime()));
  }

  const nudgesByDay = new Map<string, Set<string>>();
  const earliestActivity = new Map<string, string>();
  const noteActivity = (userId: string, date: string) => {
    const seen = earliestActivity.get(userId);
    if (seen === undefined || date < seen) {
      earliestActivity.set(userId, date);
    }
  };
  for (const send of sends) {
    const key = dayKey(send.userId, send.localDate);
    const kinds = nudgesByDay.get(key) ?? new Set<string>();
    kinds.add(send.nudge);
    nudgesByDay.set(key, kinds);
    noteActivity(send.userId, send.localDate);
  }
  for (const attempt of unplaced) {
    noteActivity(attempt.userId, attempt.localDate);
  }
  for (const sit of sits) {
    noteActivity(sit.userId, sit.sessionDate);
  }

  const days = listDays(reportWindow);

  // Baseline days start at signup so days before an account existed are not counted
  // as missed sits. The signup date is UTC and can trail the local day by one, so
  // earlier activity moves the start back to it.
  const firstBaselineDay = (userId: string): string => {
    const signup = input.signupDates.get(userId);
    const activity = earliestActivity.get(userId) ?? reportWindow.end;
    const first = signup !== undefined && signup < activity ? signup : activity;
    return first > reportWindow.start ? first : reportWindow.start;
  };

  const summarize = (nudge: string, rowSends: NudgeSend[]): NudgeEffectivenessRow => {
    const firstSentAt = new Map<string, number>();
    const cohort = new Set<string>();
    for (const send of rowSends) {
      const key = dayKey(send.userId, send.localDate);
      firstSentAt.set(key, Math.min(firstSentAt.get(key) ?? Infinity, send.sentAt.getTime()));
      cohort.add(send.userId);
    }

    let converted = 0;
    let satOnNudgedDay = 0;
    let sharedDays = 0;
    for (const [key, sentAt] of firstSentAt) {
      const sitAt = latestSitAt.get(key);
      if (sitAt !== undefined) {
        satOnNudgedDay += 1;
        if (sitAt >= sentAt) {
          converted += 1;
        }
      }
      if ((nudgesByDay.get(key)?.size ?? 0) > 1) {
        sharedDays += 1;
      }
    }

    let unnudgedDays = 0;
    let satOnUnnudgedDay = 0;
    for (const userId of cohort) {
      const firstDay = firstBaselineDay(userId);
      for (const day of days) {
        const key = dayKey(userId, day);
        if (day < firstDay || nudgesByDay.has(key)) {
          continue;
        }
        unnudgedDays += 1;
        if (latestSitAt.has(key)) {
          satOnUnnudgedDay += 1;
        }
      }
    }

    return {
      nudge,
      source: sourceOf(nudge),
      sent: rowSends.length,
      users: cohort.size,
      nudgedDays: firstSentAt.size,
      sharedDays,
      conversion: toRateWithInterval(converted, firstSentAt.size),
      nudgedDaySits: toRate(satOnNudgedDay, firstSentAt.size),
      unnudgedDaySits: toRate(satOnUnnudgedDay, unnudgedDays),
    };
  };

  // Known types always get a row, even when nothing was sent. Anything else that
  // reaches the input gets one too, so the all-nudges row never counts a hidden type.
  const kinds: string[] = [...LEDGER_NUDGE_TYPES, CALL_NUDGE];
  for (const send of sends) {
    if (!kinds.includes(send.nudge)) {
      kinds.push(send.nudge);
    }
  }
  const rows = kinds.map((nudge) => summarize(nudge, sends.filter((send) => send.nudge === nudge)));
  rows.push(summarize(ALL_NUDGES, sends));

  // Attempts that never became a call were selected exactly like call days (no sit
  // by the slot), which makes them the closest thing this data has to a holdout.
  const firstAttemptAt = new Map<string, number>();
  for (const attempt of unplaced) {
    const key = dayKey(attempt.userId, attempt.localDate);
    firstAttemptAt.set(key, Math.min(firstAttemptAt.get(key) ?? Infinity, attempt.attemptedAt.getTime()));
  }
  let unplacedDays = 0;
  let unplacedConverted = 0;
  for (const [key, attemptedAt] of firstAttemptAt) {
    if (nudgesByDay.get(key)?.has(CALL_NUDGE)) {
      continue;
    }
    unplacedDays += 1;
    const sitAt = latestSitAt.get(key);
    if (sitAt !== undefined && sitAt >= attemptedAt) {
      unplacedConverted += 1;
    }
  }

  return {
    window: reportWindow,
    generatedAt: now.toISOString(),
    rows,
    unplacedCalls: {
      attempts: unplaced.length,
      days: unplacedDays,
      conversion: toRateWithInterval(unplacedConverted, unplacedDays),
    },
    unmeasuredLedgerRows: input.unmeasuredLedgerRows,
    unparsedWindowKeys: input.unparsedWindowKeys,
  };
}

/**
 * Completed sits credited to a day in the window: the bulk form of
 * `userCompletedSessionOnDate()`, with the same predicate (`completed`, not a
 * `focus` session (#765), matched on the local `session_date`) in one query
 * instead of one per user-day.
 *
 * `sessions.created_at` has no time zone. Its `now()` default stores UTC under
 * Neon's UTC session time zone, which is how Drizzle reads it back, so it orders
 * correctly against the dispatch and call timestamps.
 */
async function loadCompletedSits(userIds: string[], reportWindow: ReportWindow): Promise<CompletedSit[]> {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      userId: sessions.userId,
      sessionDate: sessions.sessionDate,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        inArray(sessions.userId, userIds),
        eq(sessions.completed, true),
        ne(sessions.sessionType, "focus"),
        gte(sessions.sessionDate, reportWindow.start),
        lte(sessions.sessionDate, reportWindow.end),
      ),
    );
  return rows.map((row) => ({ userId: row.userId, sessionDate: row.sessionDate, savedAt: row.createdAt }));
}

async function loadSignupDates(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(inArray(users.id, userIds));
  return new Map(rows.map((row) => [row.id, row.createdAt.toISOString().slice(0, 10)]));
}

/** Reads everything the report needs for `window`. SELECTs only. */
export async function loadNudgeEffectivenessInput(reportWindow: ReportWindow): Promise<NudgeEffectivenessInput> {
  const readFrom = new Date(`${addDaysToIsoDate(reportWindow.start, -SENT_AT_MARGIN_DAYS)}T00:00:00.000Z`);
  const readTo = new Date(`${addDaysToIsoDate(reportWindow.end, SENT_AT_MARGIN_DAYS + 1)}T00:00:00.000Z`);
  const inWindow = (date: string) => date >= reportWindow.start && date <= reportWindow.end;

  const [ledgerRows, attemptRows] = await Promise.all([
    db
      .select({
        userId: notificationDispatches.userId,
        notificationType: notificationDispatches.notificationType,
        windowKey: notificationDispatches.windowKey,
        sentAt: notificationDispatches.sentAt,
      })
      .from(notificationDispatches)
      .where(and(gte(notificationDispatches.sentAt, readFrom), lt(notificationDispatches.sentAt, readTo))),
    db
      .select({
        userId: callAttempts.userId,
        windowKey: callAttempts.windowKey,
        status: callAttempts.status,
        createdAt: callAttempts.createdAt,
      })
      .from(callAttempts)
      .where(and(gte(callAttempts.createdAt, readFrom), lt(callAttempts.createdAt, readTo))),
  ]);

  const measured = new Set<string>(LEDGER_NUDGE_TYPES);
  const sends: NudgeSend[] = [];
  const unplacedCallAttempts: UnplacedCallAttempt[] = [];
  const unmeasuredLedgerRows: Record<string, number> = {};
  let unparsedWindowKeys = 0;

  for (const row of ledgerRows) {
    const localDate = localPracticeDateForWindowKey(row.notificationType, row.windowKey);
    if (localDate === null) {
      unparsedWindowKeys += 1;
      continue;
    }
    if (!inWindow(localDate)) {
      continue;
    }
    if (measured.has(row.notificationType)) {
      sends.push({ userId: row.userId, nudge: row.notificationType, localDate, sentAt: row.sentAt });
    } else {
      unmeasuredLedgerRows[row.notificationType] = (unmeasuredLedgerRows[row.notificationType] ?? 0) + 1;
    }
  }

  for (const row of attemptRows) {
    const localDate = localPracticeDateForWindowKey(CALL_NUDGE, row.windowKey);
    if (localDate === null) {
      unparsedWindowKeys += 1;
      continue;
    }
    if (!inWindow(localDate)) {
      continue;
    }
    if (row.status === PLACED_CALL_STATUS) {
      sends.push({ userId: row.userId, nudge: CALL_NUDGE, localDate, sentAt: row.createdAt });
    } else {
      unplacedCallAttempts.push({ userId: row.userId, localDate, attemptedAt: row.createdAt });
    }
  }

  const nudgedUserIds = [...new Set(sends.map((send) => send.userId))];
  const sitUserIds = [...new Set([...nudgedUserIds, ...unplacedCallAttempts.map((attempt) => attempt.userId)])];
  const [sits, signupDates] = await Promise.all([
    loadCompletedSits(sitUserIds, reportWindow),
    loadSignupDates(nudgedUserIds),
  ]);

  return {
    window: reportWindow,
    sends,
    unplacedCallAttempts,
    sits,
    signupDates,
    unmeasuredLedgerRows,
    unparsedWindowKeys,
  };
}

export async function buildNudgeEffectivenessReport(
  reportWindow: ReportWindow,
  now: Date = new Date(),
): Promise<NudgeEffectivenessReport> {
  return computeNudgeEffectiveness(await loadNudgeEffectivenessInput(reportWindow), now);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatRate(value: Rate): string {
  return value.rate === null ? "—" : `${percent(value.rate)} (${value.count} of ${value.total})`;
}

function formatConversion(value: RateWithInterval): string {
  if (value.rate === null || value.interval === null) {
    return "—";
  }
  return `${percent(value.rate)} (${percent(value.interval.low)}–${percent(value.interval.high)})`;
}

function nudgeLabel(nudge: string): string {
  return nudge === ALL_NUDGES ? "All nudges" : `\`${nudge}\``;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Paste-ready Markdown for an issue comment: the numbers, the definitions behind
 * them, and the selection-effect caveat. Aggregates only, never a user id.
 */
export function formatNudgeEffectivenessMarkdown(report: NudgeEffectivenessReport): string {
  const { window: reportWindow, rows, unplacedCalls } = report;
  const lines: string[] = [
    `### Nudge → sit conversion, ${reportWindow.start} to ${reportWindow.end} (${reportWindow.days} local days)`,
    "",
    `Generated ${report.generatedAt} with \`npm run report:notification-effectiveness -- --days ${reportWindow.days} --end ${reportWindow.end}\` (#675).`,
    "",
  ];

  const settled = settledThrough(new Date(report.generatedAt));
  if (reportWindow.end > settled) {
    lines.push(
      `> **Warning:** the window ends after ${settled}, so its last days may still be open in some timezones. A sit or a nudge can still come on those days, so conversion and both baseline sit rates are not final.`,
      "",
    );
  }
  if (report.unparsedWindowKeys > 0) {
    lines.push(
      `> **Warning:** ${plural(report.unparsedWindowKeys, "row")} near the window had a \`window_key\` that is not a local date, so they were skipped.`,
      "",
    );
  }

  lines.push(
    "| Nudge | Source | Sent | Users | Nudged days | Sat after nudge | Conversion (95% CI) | Shared days |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) =>
      `| ${nudgeLabel(row.nudge)} | ${row.source === "all" ? "both" : `\`${row.source}\``} | ${row.sent} | ${row.users} | ${row.nudgedDays} | ${row.conversion.count} | ${formatConversion(row.conversion)} | ${row.sharedDays} |`,
    ),
    "",
    "**Baseline: the same users, with and without a nudge**",
    "",
    "| Nudge | Sit rate on nudged days | Sit rate on days with no nudge |",
    "|---|---:|---:|",
    ...rows.map((row) =>
      `| ${nudgeLabel(row.nudge)} | ${formatRate(row.nudgedDaySits)} | ${formatRate(row.unnudgedDaySits)} |`,
    ),
    "",
  );

  if (unplacedCalls.attempts === 0) {
    lines.push("**Calls attempted but not placed:** none in this window.");
  } else {
    lines.push(
      `**Calls attempted but not placed:** ${plural(unplacedCalls.attempts, "attempt")} had a status other than \`initiated\`. ` +
        `On ${plural(unplacedCalls.days, "user-day")} with an attempt but no placed call, a sit followed the first attempt on ` +
        `${unplacedCalls.conversion.count}: ${formatConversion(unplacedCalls.conversion)}. Those days were selected exactly like call days (no sit by the call slot), ` +
        "so they are the closest thing to a holdout here. They are not random, though: every call fails while Vapi is unconfigured, " +
        "so the time period and the users can differ from call days.",
    );
  }
  lines.push("");

  lines.push(
    "**How to read this**",
    "",
    "- **Day:** the user's local practice day, meaning the dispatch's `window_key` date matched to `sessions.session_date`. Only completed sits count, the same test as `userCompletedSessionOnDate()`.",
    "- **Sent:** a push is a `notification_dispatches` row, which is kept only when at least one device accepted the push. APNs and web push are pooled: the ledger does not record which one delivered, so this report cannot compare them. A call is a `call_attempts` row with status `initiated`: the call was placed, but whether anyone answered is not recorded.",
    "- **Conversion:** nudged days with a completed sit saved at or after that day's first nudge of the kind. Several calls on one day count as one nudged day.",
    "- **Cohort:** each row covers only the users who got that nudge at least once in the window. Users who never got it are left out, not counted as zero.",
    "- **Shared days:** nudged days on which another kind of nudge also went out. The rows overlap, so they are not independent effects.",
    "- **Baseline:** the same users' days with no nudge of any kind, from signup to the window end. Signup is a UTC date, so it can be off by a day.",
    "- **Selection effect:** every nudge is skipped once the day already has a sit. Days with no nudge therefore lean toward days the user had already sat, and nudged days are by construction days not yet sat. The gap between the two sit rates is not the lift a nudge causes. Only a holdout, randomly withholding nudges, can measure that.",
    "- **Intervals:** 95% Wilson intervals that treat user-days as independent. Repeat days from the same user make the real uncertainty wider. Rows whose intervals overlap cannot be told apart at this sample size.",
  );

  const unmeasured = Object.entries(report.unmeasuredLedgerRows).sort(([a], [b]) => a.localeCompare(b));
  if (unmeasured.length > 0) {
    const counts = unmeasured.map(([type, count]) => `\`${type}\` ×${count}`).join(", ");
    const reasons: string[] = [];
    if (CALL_NUDGE in report.unmeasuredLedgerRows) {
      reasons.push("The call row counts `call_attempts` instead, because the ledger keeps its claim when Vapi rejects a call.");
    }
    if (unmeasured.some(([type]) => type !== CALL_NUDGE)) {
      reasons.push("Other types are not in `LEDGER_NUDGE_TYPES` yet.");
    }
    lines.push(`- **Not measured:** ledger rows ${counts}. ${reasons.join(" ")}`);
  }

  return `${lines.join("\n")}\n`;
}
