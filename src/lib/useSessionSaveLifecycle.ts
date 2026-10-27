import { useCallback, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { BreathSessionResult } from "@/components/BreathCountView";
import type { User } from "@/lib/api";
import { combinedSitField, previewNextCombinedDuration } from "@/lib/combinedSit";
import type { FocusCategory, SessionType, Track } from "@/lib/constants";
import { focusActivityDayAfterCompletedSave, type FocusSessionResult } from "@/lib/focusActivity";
import {
  getWebSessionSyncCoordinator,
  type CreateSessionPayload,
  type PendingSessionThought,
} from "@/lib/offlineSessionQueue";
import { creditedPracticeDate, rememberStandardSit } from "@/lib/practiceDaySits";
import { getLocalIsoDate, type PracticeDaySit } from "@/lib/sessionCalendar";
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

type UseSessionSaveLifecycleOptions = {
  /** #666: the page's session generation. A save that settles after a sign-out
   *  (or a different sign-in) cannot re-raise the offline strip, reopen the
   *  completion screen, or close whatever the next account has open (#833). */
  sessionGeneration: RefObject<number>;
  /** Sits used to decide whether yesterday is still open. A pending sit is
   *  remembered here. */
  loadedSitsRef: RefObject<PracticeDaySit[] | null>;
  user: User | null;
  userRef: RefObject<User | null>;
  /** #836: a stored, completed focus session steps the in-memory focus goal. */
  setUser: Dispatch<SetStateAction<User | null>>;
  refreshUserFromServer: () => void;
  refreshTodayTracks: () => Promise<void>;
  /** The page's overlay setter: opens the completion screen, or closes the sit. */
  setOverlay: (overlay: "complete" | null) => void;
};

/**
 * #703 — every way a finished sit is written to the local queue (completed,
 * retried, abandoned, breath, focus), what the completion screen shows for it,
 * and whether a local write has failed on this device.
 */
export function useSessionSaveLifecycle({
  sessionGeneration,
  loadedSitsRef,
  user,
  userRef,
  setUser,
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
  // The session generation of the breath save in flight, or null. Scoped to the
  // generation rather than a boolean so the previous account's save can neither
  // swallow the next account's End nor release its gate (#833).
  const breathSavingRef = useRef<number | null>(null);
  // The same gate for a focus save (#836).
  const focusSavingRef = useRef<number | null>(null);
  // #930: the standard sits whose save, completed or abandoned, is running, by
  // `sitKey`. A second terminal call for one of them (End Early twice, Abandon
  // after End Early) is refused: it would mint a second client id, and the
  // queue and `POST /api/sessions` keep two ids as two sits. The breath and
  // focus gates are keyed to the generation; this one is keyed to the sit,
  // because a standard sit's save can outlive its screen. Browser Back closes
  // the sit while an upload may still be waiting (up to `UPLOAD_TIMEOUT_MS`
  // each), and a sit begun after that must still save. No key is ever reused,
  // so a save still running for the previous account cannot hold up the next
  // account's either (#833).
  const sitSavesRunningRef = useRef(new Set<string>());

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
        // #769: the key only on a combined sit, so every other request is unchanged.
        ...combinedSitField(data.combined),
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

  // A pending sit is not on the server yet, so the refresh inside the save
  // cannot see it. Remember it so the next sit in this grace window knows
  // yesterday's required sits. A combined sit (#769) is remembered as done
  // for both tracks; an ended-early or not-stored one is not remembered.
  // Shared by the first save and its retry, so a sit stored only on retry is
  // remembered the same way.
  const rememberStoredSit = useCallback((
    data: CompletedSitInput,
    sessionDate: string,
    outcome: SessionSaveOutcome | null,
  ) => {
    if (
      data.completed
      && data.sessionType === "standard"
      && outcome
      && outcome.status !== "notStored"
    ) {
      loadedSitsRef.current = rememberStandardSit(
        loadedSitsRef.current,
        sessionDate,
        data.track,
        data.combined === true,
      );
    }
  }, [loadedSitsRef]);

  // #703 — cross-client note on the completion view. iOS never renders one for a
  // sit it could not store: `SessionViewModel.saveSession` returns nil when the
  // local write throws, and `SessionViewModel.completeSit` puts up the "Session
  // could not be saved" alert (Retry / Continue without saving) instead of
  // calling `completeSession`. Web has no equivalent interception point — the
  // completion overlay *is* the screen — so it delivers the same two facts
  // inside it: the sit was not stored, and Retry. The offline strip's withdrawn
  // promise is mirrored on both clients (shared `OfflineIndicatorCopy` +
  // `AppViewModel.localSaveFailed`), because iOS's "Continue without saving"
  // leaves the user looking at the same false reassurance this ticket is about.
  const handleSessionComplete = useCallback(async (data: CompletedSitInput) => {
    // #930: one save per sit — see `sitSavesRunningRef`.
    const sitSavesRunning = sitSavesRunningRef.current;
    if (sitSavesRunning.has(data.sitKey)) return;
    sitSavesRunning.add(data.sitKey);
    try {
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

      rememberStoredSit(data, sessionDate, outcome);

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
        // #769: after a combined sit, "tomorrow" is what the next two sits add up to.
        nextDuration: data.combined && user
          ? previewNextCombinedDuration({
            completed: data.completed,
            currentDay: user.currentDay,
            secondTrackDay: user.secondTrackDay ?? 1,
          })
          : previewNextStandardDuration(data.sessionType, data.completed, data.track, user),
      });
      setOverlay("complete");
    } finally {
      // Let go once the save is over, however it ended: the gate holds only
      // saves still running.
      sitSavesRunning.delete(data.sitKey);
    }
  }, [sessionGeneration, loadedSitsRef, userRef, user, saveCompletedSit, rememberStoredSit, setOverlay]);

  // #703: retry the local save without leaving the completion screen — the web
  // counterpart of the iOS "Session could not be saved" alert's Retry button.
  // Rejects while the sit is still nowhere, which is what puts the banner's
  // button back into its retry state.
  const handleRetryCompletionSave = useCallback(async () => {
    const pending = lastCompletedSitRef.current;
    if (!pending || !user?.id) {
      throw new Error("Failed to save session");
    }

    // The #666 guard, as in `handleSessionComplete`: the save below suspends.
    const generation = sessionGeneration.current;
    const outcome = await saveCompletedSit(
      pending.data,
      pending.clientSessionId,
      user.id,
      pending.sessionDate,
    );
    if (outcome.status === "notStored") {
      throw new Error("Failed to save session");
    }

    // The first try was not stored, so it was not remembered then. A retry
    // that settles after a sign-out leaves the next account's sits alone.
    if (generation === sessionGeneration.current) {
      rememberStoredSit(pending.data, pending.sessionDate, outcome);
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
  }, [sessionGeneration, user, saveCompletedSit, rememberStoredSit]);

  const handleSessionAbandon = useCallback(async (data: CompletedSitInput) => {
    // #930: one save per sit, shared with `handleSessionComplete`, so Abandon
    // after End Early is refused too — see `sitSavesRunningRef`.
    const sitSavesRunning = sitSavesRunningRef.current;
    if (sitSavesRunning.has(data.sitKey)) return;
    sitSavesRunning.add(data.sitKey);
    try {
      // #833: the save below waits on the server flush, so a sign-out and a new
      // sign-in can land before it settles. Closing the overlay then would end
      // the next account's sit — the same guard as `handleSessionComplete`.
      const generation = sessionGeneration.current;
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
            // #769: stored as what happened. Not completed, it credits nothing.
            ...combinedSitField(data.combined),
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

      if (generation !== sessionGeneration.current) return;
      setOverlay(null);
    } finally {
      // Let go once the save is over, as in `handleSessionComplete`.
      sitSavesRunning.delete(data.sitKey);
    }
  }, [sessionGeneration, loadedSitsRef, userRef, user, saveSitToQueue, setOverlay]);

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
    // #833: the gate and the close below are both scoped to this session's
    // generation, as in `handleSessionAbandon`. A save still running for an
    // account that has since signed out neither blocks this End nor closes the
    // overlay of the account that replaced it.
    const generation = sessionGeneration.current;
    if (breathSavingRef.current === generation) return;
    breathSavingRef.current = generation;
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
      // Released only while it is still this save's: by now the gate may belong
      // to the next account's save, and clearing it would let a second End
      // start a duplicate.
      if (breathSavingRef.current === generation) breathSavingRef.current = null;
      if (generation === sessionGeneration.current) setOverlay(null);
    }
  }, [sessionGeneration, loadedSitsRef, userRef, user, saveSitToQueue, setOverlay]);

  // #836: log a focus session (#765 increment 2/5). `null` is an End pressed
  // before a whole second passed, which saves nothing. A focus session never
  // moves meditation progression, and like a breath sit it has no completion
  // screen: End, or reaching the goal, returns straight to the Progress tab.
  // #837: `focusCategory` is what the picker chose, saved as a label only.
  const handleFocusEnd = useCallback(async (
    result: FocusSessionResult | null,
    focusCategory: FocusCategory | null = null,
  ) => {
    if (!result) {
      setOverlay(null);
      return;
    }
    // #833: the same generation-scoped gate and close as `handleBreathEnd`.
    const generation = sessionGeneration.current;
    if (focusSavingRef.current === generation) return;
    focusSavingRef.current = generation;
    try {
      if (user?.id) {
        // A missing counter (a server that predates #835) is day 1.
        const focusActivityDay = user.focusActivityDay ?? 1;
        const outcome = await saveSitToQueue(
          {
            dayNumber: focusActivityDay,
            sessionType: "focus",
            // The goal steps below the same whatever the category: there is
            // one shared focus goal.
            focusCategory,
            duration: result.duration,
            bonusSeconds: 0,
            completed: result.completed,
            actualTime: result.actualTime,
            clearPercent: 0,
            thoughtCount: 0,
            mindStateLog: [],
            // The plain calendar date, not `creditedPracticeDate`: that one
            // credits the daily meditation sit, and would stamp a focus session
            // saved before 6:00 onto yesterday while yesterday is still open.
            sessionDate: getLocalIsoDate(),
          },
          crypto.randomUUID(),
          user.id,
          [],
          "Failed to save focus session:",
        );
        // The server steps the goal once per completed session (#835). Mirror
        // it in memory, so Home shows the next goal without a reload, once the
        // session is safely stored: synced, or queued to sync later.
        if (
          result.completed
          && isSessionStored(outcome)
          && generation === sessionGeneration.current
        ) {
          setUser((prev) => (prev
            ? { ...prev, focusActivityDay: focusActivityDayAfterCompletedSave(prev.focusActivityDay, focusActivityDay) }
            : prev));
          // The server increments its own counter, so a session finished on
          // another client since this one last read the user leaves the step
          // above short. A synced save re-reads the server's value, as a synced
          // standard sit does; a queued one is re-read by the `onSynced` refresh
          // that follows its upload.
          if (outcome.status === "synced") refreshUserFromServer();
        }
      }
    } finally {
      // Released only while it is still this save's, as in `handleBreathEnd`.
      if (focusSavingRef.current === generation) focusSavingRef.current = null;
      if (generation === sessionGeneration.current) setOverlay(null);
    }
  }, [sessionGeneration, user, setUser, refreshUserFromServer, saveSitToQueue, setOverlay]);

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
    handleFocusEnd,
  };
}
