import type { Session } from "@/lib/api";
import type { Track } from "@/lib/constants";
import {
  creditedLocalIsoDate,
  GRACE_CUTOFF_HOUR,
  localIsoDateFrom,
  type PracticeDaySit,
} from "@/lib/sessionCalendar";

/** #240: which daily tracks have a completed standard sit, for HomeView's badges. */
export type TracksDone = { primary: boolean; second: boolean };

export function practiceDaySit(session: Pick<Session, "completed" | "sessionType" | "sessionDate" | "track">): PracticeDaySit {
  return {
    completed: session.completed,
    sessionType: session.sessionType,
    sessionDate: session.sessionDate,
    track: session.track,
  };
}

/** Both are the same completed standard sit: same day, same track. */
function sameStandardSit(a: PracticeDaySit, b: PracticeDaySit): boolean {
  return !!a.completed && a.sessionType === "standard"
    && !!b.completed && b.sessionType === "standard"
    && a.sessionDate === b.sessionDate
    && (a.track === "second") === (b.track === "second");
}

/** Keep a queued standard sit that the server list does not have yet. */
export function mergeRememberedSits(server: PracticeDaySit[], remembered: PracticeDaySit[]): PracticeDaySit[] {
  const merged = [...server];
  for (const sit of remembered) {
    if (!sit.completed || sit.sessionType !== "standard") continue;
    if (merged.some((row) => sameStandardSit(row, sit))) continue;
    merged.push(sit);
  }
  return merged;
}

/**
 * Practice day to stamp and to send as `/api/auth/me?date=`.
 * With no session list yet, the hours before 6:00 stay on yesterday so a
 * failed read cannot start missed-day recovery for a day still open.
 */
export function creditedPracticeDate(
  sits: PracticeDaySit[] | null,
  dualTrackEnabled: boolean,
  now = new Date(),
): string {
  if (sits == null) {
    if (now.getHours() < GRACE_CUTOFF_HOUR) return localIsoDateFrom(now, -1);
    return localIsoDateFrom(now, 0);
  }
  return creditedLocalIsoDate(sits, dualTrackEnabled, now);
}

/**
 * `sits` with a just-finished standard sit counted. A pending sit is not on the
 * server yet, so the next refresh cannot see it; remembering it lets the next
 * sit in this grace window know yesterday's required sits. Returns `sits`
 * itself when that sit is already counted.
 */
export function rememberStandardSit(
  sits: PracticeDaySit[] | null,
  sessionDate: string,
  track: Track,
): PracticeDaySit[] {
  const known = sits ?? [];
  const sit: PracticeDaySit = { completed: true, sessionType: "standard", sessionDate, track };
  return known.some((row) => sameStandardSit(row, sit)) ? known : [...known, sit];
}

/**
 * #240: per-track "completed a standard sit on `isoDay`". A missing `track`
 * (pre-#240 row) counts as the primary track.
 */
export function tracksDoneOn(sits: readonly PracticeDaySit[], isoDay: string): TracksDone {
  let primary = false;
  let second = false;
  for (const s of sits) {
    if (s.completed && s.sessionType === "standard" && s.sessionDate === isoDay) {
      if (s.track === "second") second = true;
      else primary = true;
    }
  }
  return { primary, second };
}
