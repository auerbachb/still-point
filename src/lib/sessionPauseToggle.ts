/**
 * #884: whether the session screen's pause/resume button may act. Once a sit
 * has ended (it ran out, or was ended early or abandoned) it neither pauses
 * nor resumes.
 *
 * `SessionView` stays mounted while `handleSessionComplete` and
 * `handleSessionAbandon` await the save, with the button still on screen and
 * reading "resume". Before this existed, a tap there set `isActive` again, so
 * `useElapsedClock` started the clock and cues back up: from the paused time
 * after End Early or Abandon, from zero after a sit that ran out. A restarted
 * clock that ran out before the save settled sent `onComplete` with
 * `completed: true`, which saved a second sit, even for a sit that had been
 * abandoned.
 *
 * The web counterpart of iOS `SessionTickLogic.canStart` (#848). iOS marks an
 * ended sit with two flags (`isComplete`, `isAbandoned`); web has one.
 */
export function canTogglePause({ sessionFinished }: { sessionFinished: boolean }): boolean {
  return !sessionFinished;
}
