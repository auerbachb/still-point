/**
 * ISO calendar date `YYYY-MM-DD` helpers. UTC date arithmetic (validation,
 * add/diff) matches the stored `session_date`; the local-day stamps
 * (`getLocalIsoDate`/`todayLocalIsoDate`) match the client's LOCAL timezone used
 * on the write path.
 */

const ISO_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Local wall-clock hour at which an unfinished practice day closes.
 * 6:00:00 belongs to the new calendar day; 5:59 still belongs to yesterday
 * when that day still has a required sit open.
 */
export const GRACE_CUTOFF_HOUR = 6;

/** A sit row, narrowed to the fields the practice-day rule reads. */
export type PracticeDaySit = {
  completed?: boolean | null;
  sessionType?: string | null;
  sessionDate?: string | null;
  /** Missing track counts as primary, matching pre-#240 rows. */
  track?: string | null;
};

/** Strict `YYYY-MM-DD` that parses as a real UTC calendar day and round-trips. */
export function isValidSessionCalendarDate(value: string | undefined | null): boolean {
  if (typeof value !== "string" || !ISO_CALENDAR_DAY.test(value)) return false;
  const [ys, ms, ds] = value.split("-").map(Number);
  const d = new Date(Date.UTC(ys, ms - 1, ds));
  if (Number.isNaN(d.getTime())) return false;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}` === value;
}

export function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const [ys, ms, ds] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(ys, ms - 1, ds));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, "0");
  const d = String(base.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysBetweenIsoDatesInclusive(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
}

/**
 * Calendar day as `YYYY-MM-DD` in the client's LOCAL timezone, offset by
 * `offsetDays` (negative = past, positive = future). This reads the LOCAL
 * calendar components (`getFullYear`/`getMonth`/`getDate`) and advances via
 * local `Date#setDate`, so it deliberately does NOT use UTC arithmetic — the
 * result matches the convention used to stamp `session_date` on the write path
 * for non-UTC users. Use {@link addDaysToIsoDate}/{@link daysBetweenIsoDatesInclusive}
 * instead when you need pure UTC date math on an already-stored `session_date`.
 */
/** `YYYY-MM-DD` for `now` in its local timezone, shifted by `offsetDays`. */
export function localIsoDateFrom(now: Date, offsetDays = 0): string {
  const shifted = new Date(now.getTime());
  shifted.setDate(shifted.getDate() + offsetDays);
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const d = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getLocalIsoDate(offsetDays = 0): string {
  return localIsoDateFrom(new Date(), offsetDays);
}

/**
 * Whether `isoDay` has every required standard sit.
 * Single-track: the primary sit. Two-a-day (`dualTrackEnabled`): primary and second.
 * The day stays open until both are done; one finished sit does not close it.
 */
export function isDayCompleteForEnabledTracks(
  sits: readonly PracticeDaySit[],
  isoDay: string,
  dualTrackEnabled: boolean,
): boolean {
  let primary = false;
  let second = false;
  for (const sit of sits) {
    if (!sit.completed || sit.sessionType !== "standard" || sit.sessionDate !== isoDay) continue;
    if (sit.track === "second") second = true;
    else primary = true;
  }
  return dualTrackEnabled ? primary && second : primary;
}

/**
 * Practice day a sit should be stored on.
 *
 * Before 6:00 local, an unfinished previous calendar day stays open, so the
 * sit counts for yesterday. Once every required sit for that day is done —
 * or the clock reaches 6:00 — the credited day is the local calendar date.
 * `previousDayComplete` is the caller's fact about yesterday; this function
 * does not read sessions.
 */
export function effectiveTodayLocalIsoDate(
  previousDayComplete: boolean,
  now: Date = new Date(),
): string {
  if (now.getHours() < GRACE_CUTOFF_HOUR && !previousDayComplete) {
    return localIsoDateFrom(now, -1);
  }
  return localIsoDateFrom(now, 0);
}

/**
 * Credited practice day from a session list. Before the user record is known,
 * pass `dualTrackEnabled: true` so a finished primary sit does not close a
 * two-a-day schedule early; refine once `dualTrackEnabled` is known.
 */
export function creditedLocalIsoDate(
  sits: readonly PracticeDaySit[],
  dualTrackEnabled: boolean,
  now: Date = new Date(),
): string {
  const yesterday = localIsoDateFrom(now, -1);
  const previousDayComplete = isDayCompleteForEnabledTracks(sits, yesterday, dualTrackEnabled);
  return effectiveTodayLocalIsoDate(previousDayComplete, now);
}

/**
 * Today's calendar day as `YYYY-MM-DD` in the client's LOCAL timezone — the same
 * convention used to stamp `session_date` on the write path (solo + buddy session
 * saves). History/journey gap math must use this rather than a UTC day so the
 * trailing gap to "today" lines up with locally-dated sessions for non-UTC users.
 */
export function todayLocalIsoDate(): string {
  return getLocalIsoDate();
}
