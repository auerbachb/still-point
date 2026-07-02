import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { useMindStateHold } from "@/lib/useMindStateHold";
import type { BuddySnapshot } from "@/lib/api";

export type BuddyMindState = "clear" | "thinking" | "hyperfocus";

type UseBuddyMindStateOptions = {
  sessionId: string;
  snap: BuddySnapshot | null;
  onTimerCompletePoll: () => void | Promise<void>;
};

export function useBuddyMindState({ sessionId, snap, onTimerCompletePoll }: UseBuddyMindStateOptions) {
  const [mindState, setMindState] = useState<BuddyMindState>("clear");
  const mindStateRef = useRef<BuddyMindState>(mindState);
  mindStateRef.current = mindState;
  const [mindStateLog, setMindStateLog] = useState<Array<{ time: number; state: string }>>([]);
  const mindStateLogRef = useRef(mindStateLog);
  const [showPostDistractionCapture, setShowPostDistractionCapture] = useState(false);
  const [sessionThoughts, setSessionThoughts] = useState<Array<{ timeInSession: number; text: string }>>(
    [],
  );
  const sessionThoughtsRef = useRef(sessionThoughts);
  sessionThoughtsRef.current = sessionThoughts;
  const [distractionSegmentCount, setDistractionSegmentCount] = useState(0);
  const elapsedRef = useRef(0);
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const timerAnchorRef = useRef<string | null>(null);
  const [localTimerCompleted, setLocalTimerCompleted] = useState(false);
  const localTimerCompletedRef = useRef(false);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const buddyHoldActive = snap?.state === "active";

  const finalizeActiveBuddyHold = useCallback((atTime: number) => {
    const ms = mindStateRef.current;
    if (ms !== "thinking" && ms !== "hyperfocus") return;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog((prev) => {
      const next = [...prev, { time: atTime, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
  }, []);

  const beginBuddyDistraction = useCallback(() => {
    if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    setMindState("thinking");
    mindStateRef.current = "thinking";
    setMindStateLog((prev) => {
      const next = [...prev, { time: elapsedRef.current, state: "thinking" }];
      mindStateLogRef.current = next;
      return next;
    });
    setDistractionSegmentCount((c) => c + 1);
  }, [showPostDistractionCapture]);

  const beginBuddyHyperfocus = useCallback(() => {
    if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    setMindState("hyperfocus");
    mindStateRef.current = "hyperfocus";
    setMindStateLog((prev) => {
      const next = [...prev, { time: elapsedRef.current, state: "hyperfocus" }];
      mindStateLogRef.current = next;
      return next;
    });
  }, [showPostDistractionCapture]);

  const endBuddyHoldFromKeyboard = useCallback(() => {
    finalizeActiveBuddyHold(elapsedRef.current);
  }, [finalizeActiveBuddyHold]);

  const { holdKindRef, resetHoldTracking } = useMindStateHold({
    enabled: buddyHoldActive,
    beginDistraction: beginBuddyDistraction,
    beginHyperfocus: beginBuddyHyperfocus,
    endHoldFromKeyboard: endBuddyHoldFromKeyboard,
  });

  const resetForSession = useCallback(() => {
    setMindStateLog([]);
    mindStateLogRef.current = [];
    setSessionThoughts([]);
    sessionThoughtsRef.current = [];
    timerAnchorRef.current = null;
    setLocalTimerCompleted(false);
    localTimerCompletedRef.current = false;
    setMindState("clear");
    mindStateRef.current = "clear";
    setShowPostDistractionCapture(false);
    setDistractionSegmentCount(0);
    elapsedRef.current = 0;
    setDisplayElapsed(0);
  }, []);

  useEffect(() => {
    resetForSession();
  }, [sessionId, resetForSession]);

  useEffect(() => {
    if (snap?.state !== "active" || !snap.startedAt) return;
    const anchor = `${sessionId}:${snap.startedAt}`;
    if (timerAnchorRef.current === anchor) return;
    timerAnchorRef.current = anchor;
    setMindState("clear");
    setMindStateLog([]);
    mindStateLogRef.current = [];
    setShowPostDistractionCapture(false);
    resetHoldTracking();
    setSessionThoughts([]);
    sessionThoughtsRef.current = [];
    setDistractionSegmentCount(0);
    setLocalTimerCompleted(false);
    localTimerCompletedRef.current = false;
  }, [sessionId, snap?.state, snap?.startedAt, resetHoldTracking]);

  const handleElapsedChange = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed;
    setDisplayElapsed(elapsed);
  }, []);

  const buddyAwarenessPct = useMemo(() => {
    if (!snap?.startedAt || snap.state !== "active") return 100;
    const cap = Math.max(snap.durationSeconds, 1);
    const endT = Math.min(cap, displayElapsed);
    return computeClearPercentFromLog(mindStateLog, endT);
  }, [snap?.startedAt, snap?.state, snap?.durationSeconds, displayElapsed, mindStateLog]);

  const handleSaveThought = (text: string) => {
    setSessionThoughts((prev) => [...prev, { timeInSession: Math.round(elapsedRef.current), text }]);
    setShowPostDistractionCapture(false);
  };

  const handleDismissPostCapture = () => {
    setShowPostDistractionCapture(false);
  };

  const openThoughtCapture = () => {
    finalizeActiveBuddyHold(elapsedRef.current);
    setShowPostDistractionCapture(true);
  };

  const closeOpenBuddyHold = useCallback(() => {
    if (mindStateRef.current !== "thinking" && mindStateRef.current !== "hyperfocus") return;
    const duration = snapRef.current?.durationSeconds;
    const at =
      duration && duration > 0 ? Math.min(duration, elapsedRef.current) : elapsedRef.current;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog((prev) => {
      const next = [...prev, { time: at, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
    setShowPostDistractionCapture(false);
    resetHoldTracking();
  }, [resetHoldTracking]);

  const handleBuddyTimerComplete = useCallback(() => {
    setLocalTimerCompleted(true);
    localTimerCompletedRef.current = true;
    closeOpenBuddyHold();
    void onTimerCompletePoll();
  }, [onTimerCompletePoll, closeOpenBuddyHold]);

  return {
    mindState,
    mindStateRef,
    mindStateLog,
    mindStateLogRef,
    showPostDistractionCapture,
    sessionThoughts,
    sessionThoughtsRef,
    distractionSegmentCount,
    elapsedRef,
    displayElapsed,
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
    resetForSession,
  };
}
