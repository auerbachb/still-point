import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "@/lib/api";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { todayLocalIsoDate } from "@/lib/sessionCalendar";
import { formatBuddyActionError } from "@/lib/buddySessionRoomUtils";
import type { BuddySnapshot } from "@/lib/api";

/** Payload for the shared `/app` completion screen after a buddy sit (#119). */
export type BuddyPersonalRecordPayload = {
  sessionId: string;
  dayNumber: number;
  duration: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
};

type FinalizeAttemptResult = "started" | "already-saving" | "not-ready" | "failed";

type UseBuddySessionFinalizationOptions = {
  sessionId: string;
  snap: BuddySnapshot | null;
  snapRef: RefObject<BuddySnapshot | null>;
  mindStateLogRef: RefObject<Array<{ time: number; state: string }>>;
  sessionThoughtsRef: RefObject<Array<{ timeInSession: number; text: string }>>;
  elapsedRef: RefObject<number>;
  localTimerCompleted: boolean;
  localTimerCompletedRef: RefObject<boolean>;
  pollStopped: boolean;
  onPersonalRecordComplete?: (data: BuddyPersonalRecordPayload) => void;
};

export function useBuddySessionFinalization({
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
}: UseBuddySessionFinalizationOptions) {
  const serverFinalizeTriggeredRef = useRef(false);
  const localTimerFinalizeTriggeredRef = useRef(false);
  const pollStoppedFinalizeTriggeredRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const [isSavingPersonalRecord, setIsSavingPersonalRecord] = useState(false);
  const [personalRecordError, setPersonalRecordError] = useState<string | null>(null);

  const resetForSession = useCallback(() => {
    serverFinalizeTriggeredRef.current = false;
    localTimerFinalizeTriggeredRef.current = false;
    pollStoppedFinalizeTriggeredRef.current = false;
    saveInFlightRef.current = false;
    setIsSavingPersonalRecord(false);
    setPersonalRecordError(null);
  }, []);

  useEffect(() => {
    resetForSession();
  }, [sessionId, resetForSession]);

  useEffect(() => {
    if (snap?.state !== "active" || !snap.startedAt) return;
    serverFinalizeTriggeredRef.current = false;
    localTimerFinalizeTriggeredRef.current = false;
    pollStoppedFinalizeTriggeredRef.current = false;
    setPersonalRecordError(null);
  }, [sessionId, snap?.state, snap?.startedAt]);

  const finalizePersonalSession = useCallback(async (): Promise<FinalizeAttemptResult> => {
    if (!onPersonalRecordComplete) return "not-ready";
    if (saveInFlightRef.current) return "already-saving";
    const snapNow = snapRef.current;
    if (!snapNow) return "not-ready";
    if (snapNow.state !== "completed" && !localTimerCompletedRef.current) return "not-ready";

    saveInFlightRef.current = true;
    setIsSavingPersonalRecord(true);
    setPersonalRecordError(null);
    try {
      const durationSeconds = Math.max(
        1,
        snapNow.durationSeconds || Math.round(elapsedRef.current ?? 0),
      );
      const clearPercent = computeClearPercentFromLog(mindStateLogRef.current ?? [], durationSeconds);
      const thoughtsSnapshot = sessionThoughtsRef.current ?? [];
      const { session } = await api.recordBuddyPersonalSession(sessionId, {
        clearPercent,
        thoughtCount: thoughtsSnapshot.length,
        mindStateLog: mindStateLogRef.current ?? [],
        actualTime: durationSeconds,
        sessionDate: todayLocalIsoDate(),
        thoughts: thoughtsSnapshot,
      });
      try {
        await api.leaveBuddySession(sessionId);
      } catch (leaveErr) {
        console.error("Buddy leave after personal record:", leaveErr);
      }
      onPersonalRecordComplete({
        sessionId: session.id,
        dayNumber: session.dayNumber,
        duration: session.duration,
        clearPercent: session.clearPercent,
        thoughtCount: session.thoughtCount,
        thoughts: thoughtsSnapshot,
      });
      return "started";
    } catch (e) {
      setPersonalRecordError(formatBuddyActionError(e, "Could not save your session"));
      return "failed";
    } finally {
      saveInFlightRef.current = false;
      setIsSavingPersonalRecord(false);
    }
  }, [sessionId, onPersonalRecordComplete, snapRef, mindStateLogRef, sessionThoughtsRef, elapsedRef, localTimerCompletedRef]);

  useEffect(() => {
    if (snap?.state !== "completed" || !onPersonalRecordComplete) return;
    if (serverFinalizeTriggeredRef.current) return;
    void finalizePersonalSession().then((result) => {
      if (result === "started") {
        serverFinalizeTriggeredRef.current = true;
      }
    });
  }, [snap?.state, sessionId, onPersonalRecordComplete, finalizePersonalSession]);

  useEffect(() => {
    if (!localTimerCompleted || !onPersonalRecordComplete) return;
    if (localTimerFinalizeTriggeredRef.current) return;
    void finalizePersonalSession().then((result) => {
      if (result === "started") {
        localTimerFinalizeTriggeredRef.current = true;
      }
    });
  }, [localTimerCompleted, onPersonalRecordComplete, finalizePersonalSession]);

  useEffect(() => {
    if (!pollStopped || !localTimerCompleted || !onPersonalRecordComplete) return;
    if (pollStoppedFinalizeTriggeredRef.current) return;
    void finalizePersonalSession().then((result) => {
      if (result === "started") {
        pollStoppedFinalizeTriggeredRef.current = true;
      }
    });
  }, [pollStopped, localTimerCompleted, onPersonalRecordComplete, finalizePersonalSession]);

  return {
    personalRecordError,
    isSavingPersonalRecord,
    finalizePersonalSession,
    resetForSession,
  };
}
