/** ISO calendar date `YYYY-MM-DD` helpers (UTC date arithmetic; matches stored `session_date`). */

const ISO_CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

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
export function getLocalIsoDate(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
