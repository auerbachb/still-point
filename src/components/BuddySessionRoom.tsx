"use client";

import { useIsMobile } from "@/lib/useIsMobile";
import { useKeepScreenAwakePref, useWakeLock } from "@/lib/useWakeLock";
import { useSessionSuppressionRelay } from "@/lib/useSessionSuppression";
import { useBuddySessionSnapshot } from "@/lib/useBuddySessionSnapshot";
import { useDailyMeetingToken } from "@/lib/useDailyMeetingToken";
import { useBuddyAudioUnlock } from "@/lib/useBuddyAudioUnlock";
import { useBuddyMindState } from "@/lib/useBuddyMindState";
import {
  useBuddySessionFinalization,
  type BuddyPersonalRecordPayload,
} from "@/lib/useBuddySessionFinalization";
import { BuddySessionLobby } from "./buddy/BuddySessionLobby";
import { BuddySessionActive } from "./buddy/BuddySessionActive";
import {
  BuddySessionAbandonedView,
  BuddySessionCompletedView,
} from "./buddy/BuddySessionTerminalViews";
import { btnSecondary } from "./buddy/buddySessionRoomStyles";

export type { BuddyPersonalRecordPayload };

type BuddySessionRoomProps = {
  sessionId: string;
  currentUserId: string;
  calendarMessage?: string | null;
  onExit: () => void;
  /** When set, a finished shared timer saves a personal session row then opens the normal completion flow. */
  onPersonalRecordComplete?: (data: BuddyPersonalRecordPayload) => void;
};

export function BuddySessionRoom({
  sessionId,
  currentUserId,
  calendarMessage,
  onExit,
  onPersonalRecordComplete,
}: BuddySessionRoomProps) {
  const isMobile = useIsMobile();

  const {
    snap,
    snapRef,
    pollError,
    pollStopped,
    poll,
    exitingRoom,
    setReady,
    start,
    cancel,
    leave,
    completeAndExitLegacy,
  } = useBuddySessionSnapshot({ sessionId, onExit });

  const { dailyMeetingToken, dailyTokenError } = useDailyMeetingToken(sessionId, snap);

  const {
    soundPrefs,
    audioBlocked,
    handleSoundPlaybackBlocked,
    handleSoundPrefToggle,
    handleEnableLocalAudio,
  } = useBuddyAudioUnlock(sessionId);

  const {
    mindState,
    mindStateRef,
    mindStateLog,
    mindStateLogRef,
    showPostDistractionCapture,
    sessionThoughts,
    sessionThoughtsRef,
    distractionSegmentCount,
    elapsedRef,
    localTimerCompleted,
    localTimerCompletedRef,
    buddyHoldActive,
    holdKindRef,
    buddyAwarenessPct,
    finalizeActiveBuddyHold,
    beginBuddyDistraction,
    beginBuddyHyperfocus,
    handleElapsedChange,
    handleSaveThought,
    handleDismissPostCapture,
    openThoughtCapture,
    handleBuddyTimerComplete,
  } = useBuddyMindState({
    sessionId,
    snap,
    onTimerCompletePoll: poll,
  });

  const { personalRecordError, isSavingPersonalRecord, finalizePersonalSession } =
    useBuddySessionFinalization({
      sessionId,
      snap,
      snapRef,
      mindStateLogRef,
      sessionThoughtsRef,
      elapsedRef,
      localTimerCompleted,
      localTimerCompletedRef,
      pollStopped,
      onPersonalRecordComplete,
    });

  const keepScreenAwakePref = useKeepScreenAwakePref();
  useWakeLock(keepScreenAwakePref && buddyHoldActive && !localTimerCompleted && !exitingRoom);
  useSessionSuppressionRelay(buddyHoldActive && !localTimerCompleted && !exitingRoom);

  if (!snap && !pollError) {
    return (
      <div style={{ textAlign: "center", color: "var(--fg-3)", padding: "var(--s6)" }}>
        Loading session…
      </div>
    );
  }

  if (pollError && !snap) {
    return (
      <div
        style={{
          maxWidth: "400px",
          margin: "0 auto",
          textAlign: "center",
          display: "grid",
          gap: "var(--s3)",
        }}
      >
        <p style={{ color: "var(--fg-2)" }}>{pollError}</p>
        <button type="button" onClick={onExit} style={btnSecondary}>
          Back
        </button>
      </div>
    );
  }

  if (!snap) return null;

  if (snap.state === "abandoned") {
    return (
      <BuddySessionAbandonedView pollError={pollError} onLeave={() => void leave()} />
    );
  }

  if (snap.state === "completed") {
    return (
      <BuddySessionCompletedView
        pollError={pollError}
        hasPersonalRecordFlow={Boolean(onPersonalRecordComplete)}
        personalRecordError={personalRecordError}
        isSavingPersonalRecord={isSavingPersonalRecord}
        onCompleteLegacy={() => void completeAndExitLegacy()}
        onRetryFinalize={() => void finalizePersonalSession()}
        onLeave={() => void leave()}
      />
    );
  }

  const inLobby = snap.state === "waiting" || snap.state === "ready_check";
  const shellMaxWidth =
    snap.state === "active" && !isMobile ? "min(1120px, 100%)" : "560px";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: shellMaxWidth,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s4)",
        animation: "fadeIn 0.5s ease",
      }}
    >
      {pollError && (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--fg-2)", textAlign: "center" }}>
          {pollError}
        </p>
      )}

      <h2
        style={{
          fontSize: "22px",
          fontWeight: 300,
          fontStyle: "italic",
          margin: 0,
          color: "var(--fg)",
          textAlign: "center",
        }}
      >
        Shared session
      </h2>

      {inLobby && (
        <BuddySessionLobby
          snap={snap}
          currentUserId={currentUserId}
          calendarMessage={calendarMessage}
          onSetReady={(ready) => void setReady(ready)}
          onStart={() => void start()}
          onCancel={() => void cancel()}
          onLeave={() => void leave()}
        />
      )}

      {snap.state === "active" && (
        <BuddySessionActive
          sessionId={sessionId}
          snap={snap}
          currentUserId={currentUserId}
          isMobile={isMobile}
          mindState={mindState}
          mindStateRef={mindStateRef}
          mindStateLog={mindStateLog}
          holdKindRef={holdKindRef}
          showPostDistractionCapture={showPostDistractionCapture}
          distractionSegmentCount={distractionSegmentCount}
          sessionThoughts={sessionThoughts}
          buddyAwarenessPct={buddyAwarenessPct}
          elapsedRef={elapsedRef}
          soundPrefs={soundPrefs}
          audioBlocked={audioBlocked}
          dailyMeetingToken={dailyMeetingToken}
          dailyTokenError={dailyTokenError}
          finalizeActiveBuddyHold={finalizeActiveBuddyHold}
          beginBuddyDistraction={beginBuddyDistraction}
          beginBuddyHyperfocus={beginBuddyHyperfocus}
          onElapsedChange={handleElapsedChange}
          onSoundPlaybackBlocked={handleSoundPlaybackBlocked}
          onTimerComplete={handleBuddyTimerComplete}
          onSaveThought={handleSaveThought}
          onDismissPostCapture={handleDismissPostCapture}
          onOpenThoughtCapture={openThoughtCapture}
          onSoundPrefToggle={(key) => void handleSoundPrefToggle(key)}
          onEnableLocalAudio={() => void handleEnableLocalAudio()}
          onLeave={() => void leave()}
        />
      )}
    </div>
  );
}
