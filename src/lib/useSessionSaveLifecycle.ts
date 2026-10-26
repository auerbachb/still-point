import { useCallback, useRef, useState, type RefObject } from "react";
import type { BreathSessionResult } from "@/components/BreathCountView";
import type { User } from "@/lib/api";
import type { SessionType, Track } from "@/lib/constants";
import {
  getWebSessionSyncCoordinator,
  type CreateSessionPayload,
  type PendingSessionThought,
} from "@/lib/offlineSessionQueue";
import { creditedPracticeDate, rememberStandardSit } from "@/lib/practiceDaySits";
import type { PracticeDaySit } from "@/lib/sessionCalendar";
import { isSessionStored, resolveSessionSaveOutcome, type SessionSaveOutcome } from "@/lib/sessionSaveOutcome";
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
   *  `sessionDurationForUser` the server uses, from the pre-save user state. */
  nextDuration: number;
};

/** What `SessionView` hands back when a sit ends — completed or abandoned. */
export type CompletedSitInput = {
  dayNumber: number;
  sessionType: SessionType;
  track: Track;
  duration: number;
  bonusSeconds: number;
  completed: boolean;
  actualTime: number;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: Array<{ time: number; state: string }>;
  thoughts: Array<{ timeInSession: number; text: string }>;
};

type UseSessionSaveLifecycleOptions = {
  /** #666: the page's session generation. A save that settles after a sign-out
   *  (or a different sign-in) cannot re-raise the offline strip or reopen the
   *  completion screen. Abandon and breath still close the overlay when their
   *  save settles, whichever session is open by then (#833). */
  sessionGeneration: RefObject<number>;
  /** Sits used to decide whether yesterday is still open. A pending sit is
   *  remembered here. */
  loadedSitsRef: RefObject<PracticeDaySit[] | null>;
  user: User | null;
  userRef: RefObject<User | null>;
  refreshUserFromServer: () => void;
  refreshTodayTracks: () => Promise<void>;
  /** The page's overlay setter: opens the completion screen, or closes the sit. */
  setOverlay: (overlay: "complete" | null) => void;
};

/**
 * #703 — every way a finished sit is written to the local queue (completed,
 * retried, abandoned, breath), what the completion screen shows for it, and
 * whether a local write has failed on this device.
 */
export function useSessionSaveLifecycle({
  sessionGeneration,
  loadedSitsRef,
  user,
  userRef,
  refreshUserFromServer,
  refreshTodayTracks,
  setOverlay,
}: UseSessionSaveLifecycleOptions) {
  const [completionData, setCompletionData] = useState<CompletionData | null>(null);
  // #703: a local queue write has failed on this device and has not since
  // succeeded. Withdraws the offline strip's "sits are saved and upload when you
  // reconnect" promise, which is false for as long as storage refuses writes. A
  // later successful save clears it — that is the proof storage works again.
  const [localWriteFailed, setLocalWriteFailed] = useState(false);
  // #703: the last sit handed to the queue, kept so the completion screen can
  // retry the same one under the same client id — and on the same calendar day.
  // `sessionDate` is pinned here rather than recomputed inside the save, because
  // a sit that failed to store before midnight and is retried after it would
  // otherwise land on the following day, crediting the wrong day's progression.
  // The #557 idempotency key makes a retry the *same* sit; the date has to agree.
  const lastCompletedSitRef = useRef<
    { data: CompletedSitInput; clientSessionId: string; sessionDate: string } | null
  >(null);
  const breathSavingRef = useRef(false);

  // #703: every path that writes a sit to the local queue reports here, so the
  // offline strip's promise tracks whether local storage is actually working.
  //
  // `generation` is the #666 guard, and it belongs here rather than at each
  // save path: every one of them reports *after* an await, so a sign-out (or a
  // sign-in) that lands mid-save would otherwise let the previous account's
  // failure re-raise the strip for whoever is looking at the screen now —
  // straight past the account teardown's `clearLocalWriteFailed`, which by then
  // has already run. `saveSitToQueue` captures the generation before its await
  // and hands it back with the result.
  const noteQueueWriteOutcome = useCallback((stored: boolean, generation: number) => {
    if (generation !== sessionGeneration.current) return;
    setLocalWriteFailed(!stored);
  }, [sessionGeneration]);

  // #703: the one coordinator call behind every sit save — completed, abandoned,
  // and breath alike — so all three classify a settled save the same way. A
  // refused local write resolves to `notStored`; a sync error thrown *after* the
  // entry is durable stays `pending` — see `resolveSessionSaveOutcome` for which
  // rejection means which.
  const saveSitToQueue = useCallback(async (
    request: Omit<CreateSessionPayload, "clientSessionId">,
    clientSessionId: string,
    ownerUserId: string,
    thoughts: PendingSessionThought[],
    failureMessage: string,
  ): Promise<SessionSaveOutcome> => {
    // Captured before the save below suspends — see `noteQueueWriteOutcome`.
    const generation = sessionGeneration.current;
    let outcome: SessionSaveOutcome;
    try {
      const result = await getWebSessionSyncCoordinator().saveCompletedSession(
        request,
        clientSessionId,
        ownerUserId,
        thoughts,
      );
      outcome = resolveSessionSaveOutcome({ status: "fulfilled", value: result }, clientSessionId);
    } catch (error) {
      console.error(failureMessage, error);
      outcome = resolveSessionSaveOutcome({ status: "rejected", reason: error }, clientSessionId);
    }

    noteQueueWriteOutcome(isSessionStored(outcome), generation);
    return outcome;
  }, [sessionGeneration, noteQueueWriteOutcome]);

  // #703: the one save path for a finished sit, so the completion screen and its
  // retry button can never disagree about what happened to it. A refused local
  // write resolves to `notStored` rather than the `isPendingSync` this used to
  // claim.
  const saveCompletedSit = useCallback(async (
    data: CompletedSitInput,
    clientSessionId: string,
    ownerUserId: string,
    sessionDate: string,
  ): Promise<SessionSaveOutcome> => {
    const outcome = await saveSitToQueue(
      {
        dayNumber: data.dayNumber,
        sessionType: data.sessionType,
        track: data.track,
        duration: data.duration,
        bonusSeconds: data.bonusSeconds,
        completed: data.completed,
        actualTime: data.actualTime,
        clearPercent: data.clearPercent,
        thoughtCount: data.thoughtCount,
        mindStateLog: data.mindStateLog,
        // Pinned by the caller when the sit ended, not recomputed here — a
        // retry that crosses midnight must still be the same day's sit.
        sessionDate,
      },
      clientSessionId,
      ownerUserId,
      data.thoughts,
      "Failed to save session:",
    );

    // Unchanged for the two states that existed before: a synced standard sit
    // re-reads the user, a pending one refreshes the track badges. A sit that was
    // not stored moved nothing, so neither runs.
    if (data.completed && data.sessionType === "standard") {
      if (outcome.status === "synced") {
        refreshUserFromServer();
        void refreshTodayTracks();
      } else if (outcome.status === "pending") {
        void refreshTodayTracks();
      }
    }

    return outcome;
  }, [saveSitToQueue, refreshTodayTracks, refreshUserFromServer]);

  // #703 — cross-client note on the completion view. iOS never renders one for a
  // sit it could not store: `SessionViewModel.saveSession` returns nil when the
  // local write throws, and `SessionView.handleCompletion` puts up the "Session
  // could not be saved" alert (Retry / Continue without saving) instead of
  // calling `completeSession`. Web has no equivalent interception point — the
  // completion overlay *is* the screen — so it delivers the same two facts
  // inside it: the sit was not stored, and Retry. The offline strip's withdrawn
  // promise is mirrored on both clients (shared `OfflineIndicatorCopy` +
  // `AppViewModel.localSaveFailed`), because iOS's "Continue without saving"
  // leaves the user looking at the same false reassurance this ticket is about.
  const handleSessionComplete = useCallback(async (data: CompletedSitInput) => {
    const clientSessionId = crypto.randomUUID();
    // Read once, at the moment the sit ended — see `lastCompletedSitRef`.
    // A retry that crosses 6:00 still keeps this credited day.
    const sessionDate = creditedPracticeDate(
      loadedSitsRef.current,
      !!userRef.current?.dualTrackEnabled,
    );
    let outcome: SessionSaveOutcome | null = null;

    // #666 guard: the save below is a suspension point, and sign-out during it
    // must not let the previous account's sit reopen the completion screen over
    // the signed-out UI.
    const generation = sessionGeneration.current;

    if (user?.id) {
      // Kept for the completion screen's retry, which must reuse this exact
      // `clientSessionId` — the #557 idempotency key is what makes a retry safe.
      lastCompletedSitRef.current = { data, clientSessionId, sessionDate };
      outcome = await saveCompletedSit(data, clientSessionId, user.id, sessionDate);
    } else {
      lastCompletedSitRef.current = null;
    }

    if (generation !== sessionGeneration.current) return;

    // A pending sit is not on the server yet, so the refresh inside the save
    // cannot see it. Remember it so the next sit in this grace window knows
    // yesterday's required sits.
    if (
      data.completed
      && data.sessionType === "standard"
      && outcome
      && outcome.status !== "notStored"
    ) {
      loadedSitsRef.current = rememberStandardSit(loadedSitsRef.current, sessionDate, data.track);
    }

    setCompletionData({
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
      nextDuration: previewNextStandardDuration(data.sessionType, data.completed, data.track, user),
    });
    setOverlay("complete");
  }, [sessionGeneration, loadedSitsRef, userRef, user, saveCompletedSit, setOverlay]);

  // #703: retry the local save without leaving the completion screen — the web
  // counterpart of the iOS "Session could not be saved" alert's Retry button.
  // Rejects while the sit is still nowhere, which is what puts the banner's
  // button back into its retry state.
  const handleRetryCompletionSave = useCallback(async () => {
    const pending = lastCompletedSitRef.current;
    if (!pending || !user?.id) {
      throw new Error("Failed to save session");
    }

    const outcome = await saveCompletedSit(
      pending.data,
      pending.clientSessionId,
      user.id,
      pending.sessionDate,
    );
    if (outcome.status === "notStored") {
      throw new Error("Failed to save session");
    }

    setCompletionData((previous) => (
      previous && previous.clientSessionId === pending.clientSessionId
        ? {
          ...previous,
          sessionId: outcome.sessionId,
          isPendingSync: outcome.status === "pending",
          notStored: false,
        }
        : previous
    ));
  }, [user, saveCompletedSit]);

  const handleSessionAbandon = useCallback(async (data: CompletedSitInput) => {
    if (user?.id) {
      // #703: an abandoned sit is still a sit the queue was asked to keep. It
      // gets no completion screen, so the offline strip is the only place a
      // failed write can be said at all — and it goes through the same
      // classifier as a completed sit, so a sync error thrown after a durable
      // write does not withdraw a promise the queue is keeping.
      await saveSitToQueue(
        {
          dayNumber: data.dayNumber,
          sessionType: data.sessionType,
          track: data.track,
          duration: data.duration,
          bonusSeconds: data.bonusSeconds,
          completed: false,
          actualTime: data.actualTime,
          clearPercent: data.clearPercent,
          thoughtCount: data.thoughtCount,
          mindStateLog: data.mindStateLog,
          sessionDate: creditedPracticeDate(
            loadedSitsRef.current,
            !!userRef.current?.dualTrackEnabled,
          ),
        },
        crypto.randomUUID(),
        user.id,
        data.thoughts,
        "Failed to save abandoned session:",
      );
    }

    setOverlay(null);
  }, [loadedSitsRef, userRef, user, saveSitToQueue, setOverlay]);

  // #376: log a breath-counting session, mirroring iOS `completeBreathSession`
  // (#374). Empty sessions (entered then ended with no taps) are not logged.
  // Breath sits do not advance the daily progression, and there is no
  // completion screen — End returns straight to the Progress tab.
  const handleBreathEnd = useCallback(async (result: BreathSessionResult) => {
    // A session is empty only when no tap was ever recorded. Using tapCount
    // (not the derived elapsedSeconds/breathCount) avoids dropping a real
    // session where End was pressed within the first second of the first tap,
    // which produces elapsedSeconds=0 and breathCount=0 but tapCount>0.
    if (result.tapCount <= 0) {
      setOverlay(null);
      return;
    }
    if (breathSavingRef.current) return;
    breathSavingRef.current = true;
    try {
      if (user?.id) {
        // #703: same as the abandon path — a breath sit has no completion
        // screen, so the offline strip carries the news that it was not stored,
        // and it uses the same classifier so a sync error raised after a durable
        // write is not mistaken for one.
        await saveSitToQueue(
          {
            dayNumber: user.currentDay ?? 1,
            sessionType: "breath",
            duration: Math.max(result.elapsedSeconds, 1),
            bonusSeconds: 0,
            completed: true,
            actualTime: result.elapsedSeconds,
            clearPercent: 0,
            thoughtCount: 0,
            breathCount: result.breathCount,
            mindStateLog: [],
            sessionDate: creditedPracticeDate(
              loadedSitsRef.current,
              !!userRef.current?.dualTrackEnabled,
            ),
          },
          crypto.randomUUID(),
          user.id,
          [],
          "Failed to save breath session:",
        );
      }
    } finally {
      breathSavingRef.current = false;
      setOverlay(null);
    }
  }, [loadedSitsRef, userRef, user, saveSitToQueue, setOverlay]);

  /** Account teardown: the not-stored warning was about the previous account's sit. */
  const clearLocalWriteFailed = useCallback(() => {
    setLocalWriteFailed(false);
  }, []);

  return {
    completionData,
    setCompletionData,
    localWriteFailed,
    clearLocalWriteFailed,
    handleSessionComplete,
    handleRetryCompletionSave,
    handleSessionAbandon,
    handleBreathEnd,
  };
}
