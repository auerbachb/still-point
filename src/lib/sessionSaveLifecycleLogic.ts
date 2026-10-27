/**
 * #1004 — the pure half of `useSessionSaveLifecycle`: how a finished sit, breath
 * session, or focus session becomes a save request, what the completion screen
 * shows for a saved sit, and how a retry updates that screen.
 *
 * Nothing here reads a ref, a clock, a random id, or React state. Every id, date,
 * and day arrives already resolved, so the hook keeps sole ownership of the
 * orchestration — the save gates, generation checks, UUID minting, and date
 * pinning — and these mappings can be tested on their own.
 */
import type { BreathSessionResult } from "@/components/BreathCountView";
import type { User } from "@/lib/api";
import { combinedSitField, previewNextCombinedDuration } from "@/lib/combinedSit";
import type { FocusCategory, SessionType, Track } from "@/lib/constants";
import type { FocusSessionResult } from "@/lib/focusActivity";
import type { QueuedSessionRequest } from "@/lib/offlineSessionQueue";
import type { SessionSaveOutcome } from "@/lib/sessionSaveOutcome";
import { previewNextStandardDuration } from "@/lib/userProgression";

export type CompletionData = {
  sessionId: string | null;
  /** #558: stable local key for offline end-note sync during completion. */
  clientSessionId: string | null;
  /** #558: true when the sit is queued locally and awaiting server sync. */
  isPendingSync: boolean;
  /** #703: true when the sit reached neither the server nor this device. Never
   *  true at the same time as `isPendingSync` — that conflation is the bug. */
  notStored: boolean;
  dayNumber: number;
  sessionType: SessionType;
  /** #240: which daily track this completed sit belonged to. */
  track: Track;
  duration: number;
  bonusSeconds: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
  /** Planned duration of the *next* standard sit, accounting for recovery-ramp
   *  advancement (#238) — computed with the same `advanceProgression` /
   *  `sessionDurationForUser` the server uses, from the pre-save user state.
   *  After a combined sit (#769), what the next two sits add up to. */
  nextDuration: number;
};

/** What `SessionView` hands back when a sit ends — completed or abandoned. */
export type CompletedSitInput = {
  /** #930: which sit this is. Unique to the sit, and the same on every terminal
   *  call made for it (one per `SessionView` mount). Only the save gate reads
   *  it; it is not part of the saved request. */
  sitKey: string;
  dayNumber: number;
  sessionType: SessionType;
  track: Track;
  /** #769: today's two sits done as one, on the primary track. `SessionView`
   *  sets it only when true. */
  combined?: boolean;
  duration: number;
  bonusSeconds: number;
  completed: boolean;
  actualTime: number;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: Array<{ time: number; state: string }>;
  thoughts: Array<{ timeInSession: number; text: string }>;
};

/** A save request before the queue stamps its client id on it. */
export type SessionSaveRequest = QueuedSessionRequest;

/**
 * The request for a standard sit, completed or abandoned. `completed` is the
 * caller's to state: abandonment passes `false` whatever the input says, and
 * the builder never infers it. `sessionDate` is the credited practice date the
 * hook pinned when the sit ended — a retry that crosses midnight must still be
 * the same day's sit.
 */
export function buildStandardSitRequest(
  data: CompletedSitInput,
  sessionDate: string,
  completed: boolean,
): SessionSaveRequest {
  return {
    dayNumber: data.dayNumber,
    sessionType: data.sessionType,
    track: data.track,
    // #769: the key only on a combined sit, so every other request is unchanged.
    // An abandoned combined sit is stored as what happened; not completed, it
    // credits nothing.
    ...combinedSitField(data.combined),
    duration: data.duration,
    bonusSeconds: data.bonusSeconds,
    completed,
    actualTime: data.actualTime,
    clearPercent: data.clearPercent,
    thoughtCount: data.thoughtCount,
    mindStateLog: data.mindStateLog,
    sessionDate,
  };
}

/**
 * #376: the request for a breath-counting session, mirroring iOS
 * `completeBreathSession` (#374). The planned duration is never under one
 * second, so End pressed within the first second of the first tap still saves
 * a valid sit. `dayNumber` and `sessionDate` arrive resolved by the hook.
 */
export function buildBreathSessionRequest(
  result: BreathSessionResult,
  dayNumber: number,
  sessionDate: string,
): SessionSaveRequest {
  return {
    dayNumber,
    sessionType: "breath",
    duration: Math.max(result.elapsedSeconds, 1),
    bonusSeconds: 0,
    completed: true,
    actualTime: result.elapsedSeconds,
    clearPercent: 0,
    thoughtCount: 0,
    breathCount: result.breathCount,
    mindStateLog: [],
    sessionDate,
  };
}

/**
 * #836: the request for a focus session. `focusActivityDay` is the shared focus
 * goal's counter (#837: the category is a label only, and the goal steps the
 * same whatever it is). `calendarDate` is the plain local calendar date, not
 * `creditedPracticeDate`: that one credits the daily meditation sit, and would
 * stamp a focus session saved before 6:00 onto yesterday while yesterday is
 * still open.
 */
export function buildFocusSessionRequest(
  result: FocusSessionResult,
  focusActivityDay: number,
  focusCategory: FocusCategory | null,
  calendarDate: string,
): SessionSaveRequest {
  return {
    dayNumber: focusActivityDay,
    sessionType: "focus",
    focusCategory,
    duration: result.duration,
    bonusSeconds: 0,
    completed: result.completed,
    actualTime: result.actualTime,
    clearPercent: 0,
    thoughtCount: 0,
    mindStateLog: [],
    sessionDate: calendarDate,
  };
}

/**
 * What the completion screen shows for a sit. `outcome` is `null` when nothing
 * was saved (no signed-in user). `pending` and `notStored` are exclusive by
 * construction (#703). `user` is the pre-save snapshot the next-sit preview is
 * computed from.
 */
export function buildCompletionData(
  data: CompletedSitInput,
  outcome: SessionSaveOutcome | null,
  clientSessionId: string,
  user: User | null,
): CompletionData {
  return {
    sessionId: outcome?.sessionId ?? null,
    clientSessionId,
    isPendingSync: outcome?.status === "pending",
    notStored: outcome?.status === "notStored",
    dayNumber: data.dayNumber,
    sessionType: data.sessionType,
    track: data.track,
    duration: data.duration,
    bonusSeconds: data.bonusSeconds,
    clearPercent: data.clearPercent,
    thoughtCount: data.thoughtCount,
    thoughts: data.thoughts,
    // #769: after a combined sit, "tomorrow" is what the next two sits add up to.
    nextDuration: data.combined && user
      ? previewNextCombinedDuration({
        completed: data.completed,
        currentDay: user.currentDay,
        secondTrackDay: user.secondTrackDay ?? 1,
      })
      : previewNextStandardDuration(data.sessionType, data.completed, data.track, user),
  };
}

/**
 * #703: the completion screen after a retry stored the sit. The screen is
 * matched by client id, not by generation: a screen that has since closed, or
 * now shows a different sit, is returned unchanged.
 */
export function applyRetryOutcome(
  previous: CompletionData | null,
  clientSessionId: string,
  outcome: Exclude<SessionSaveOutcome, { status: "notStored" }>,
): CompletionData | null {
  if (!previous || previous.clientSessionId !== clientSessionId) return previous;
  return {
    ...previous,
    sessionId: outcome.sessionId,
    isPendingSync: outcome.status === "pending",
    notStored: false,
  };
}
