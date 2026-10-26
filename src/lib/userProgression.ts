import type { User } from "@/lib/api";
import type { SessionType, Track } from "@/lib/constants";
import { advanceProgression, advanceSecondTrackDay, sessionDurationForUser, type RecoveryFields } from "@/lib/duration";

/** Normalizes `User`'s optional recovery fields (absent on some legacy responses)
 *  into the non-optional shape `@/lib/duration` helpers expect. */
export function recoveryFieldsOf(user: Pick<User, "recoveryTargetDay" | "recoveryCurrentStep" | "recoveryTotalSteps">): RecoveryFields {
  return {
    recoveryTargetDay: user.recoveryTargetDay ?? null,
    recoveryCurrentStep: user.recoveryCurrentStep ?? null,
    recoveryTotalSteps: user.recoveryTotalSteps ?? null,
  };
}

export const NO_RECOVERY: Readonly<RecoveryFields> = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

/**
 * Planned duration of the *next* standard sit, previewed client-side from the
 * pre-save user state using the same `advanceProgression` / `sessionDurationForUser`
 * the server applies (#238) — so the completion screen's "tomorrow" preview stays
 * correct whether this sit advanced `currentDay` normally, stepped a recovery ramp,
 * or just completed the final recovery step.
 */
export function previewNextStandardDuration(
  sessionType: SessionType,
  completed: boolean,
  track: Track,
  user: User | null,
): number {
  if (!user) return 60;
  // #240: the second track has its own counter and no recovery ramp, so preview
  // its next length independently from the primary track's progression.
  if (track === "second") {
    const nextSecond = advanceSecondTrackDay(sessionType, completed, user.secondTrackDay ?? 1);
    return sessionDurationForUser("standard", nextSecond, NO_RECOVERY);
  }
  const next = advanceProgression(sessionType, completed, {
    currentDay: user.currentDay,
    ...recoveryFieldsOf(user),
  });
  return sessionDurationForUser("standard", next.currentDay, next);
}
