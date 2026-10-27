/**
 * #930: whether the session screen's End Early and Abandon buttons may act.
 * A sit ends once: it runs out, or it is ended early, or it is abandoned. After
 * that, neither button does anything.
 *
 * `SessionView` stays mounted while `handleSessionComplete` and
 * `handleSessionAbandon` await the save, with both buttons still on screen.
 * Before this existed, a further click there (End Early twice, Abandon twice,
 * one after the other, or either after the sit ran out) sent `onComplete` or
 * `onAbandon` again. Each call minted its own client session id, and the queue
 * and `POST /api/sessions` keep two ids as two sits.
 *
 * The companion of `canTogglePause` (#884), which keeps Pause and Resume off an
 * ended sit. iOS saves from `onChange` of `isComplete`, which fires only once,
 * and saves no abandoned sit; `ios/PARITY_CHECKLIST.md` records the difference.
 */
export function canEndSession({ sessionFinished }: { sessionFinished: boolean }): boolean {
  return !sessionFinished;
}
