import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type BuddySnapshot } from "@/lib/api";
import { BUDDY_POLICY_CODES } from "@/lib/buddyPolicyCodes";
import { formatBuddyActionError } from "@/lib/buddySessionRoomUtils";

type UseBuddySessionSnapshotOptions = {
  sessionId: string;
  onExit: () => void;
};

export function useBuddySessionSnapshot({ sessionId, onExit }: UseBuddySessionSnapshotOptions) {
  const [snap, setSnap] = useState<BuddySnapshot | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState(false);
  const lastRevision = useRef(-1);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const [exitingRoom, setExitingRoom] = useState(false);

  const poll = useCallback(async () => {
    if (pollStopped) return;
    try {
      const { snapshot } = await api.getBuddySnapshot(sessionId);
      if (snapshot.revision < lastRevision.current) return;
      lastRevision.current = snapshot.revision;
      setSnap(snapshot);
      setPollError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === BUDDY_POLICY_CODES.NOT_IN_SESSION) {
        setPollStopped(true);
        setPollError(formatBuddyActionError(e, "Could not refresh session"));
        return;
      }
      setPollError(formatBuddyActionError(e, "Could not refresh session"));
    }
  }, [pollStopped, sessionId]);

  const resetForSession = useCallback(() => {
    setSnap(null);
    snapRef.current = null;
    setPollStopped(false);
    lastRevision.current = -1;
    setExitingRoom(false);
    setPollError(null);
  }, []);

  useEffect(() => {
    resetForSession();
  }, [sessionId, resetForSession]);

  useEffect(() => {
    if (pollStopped) return;
    void poll();
    const id = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(id);
  }, [poll, pollStopped]);

  const setReady = async (ready: boolean) => {
    try {
      await api.setBuddyReady(sessionId, ready);
      await poll();
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not update ready"));
    }
  };

  const start = async () => {
    try {
      await api.startBuddySession(sessionId);
      await poll();
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not start"));
    }
  };

  const cancel = async () => {
    try {
      await api.cancelBuddySession(sessionId);
      await poll();
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not cancel"));
    }
  };

  const leave = async (opts?: { ignoreLeaveApiErrors?: boolean }) => {
    const ignoreLeaveApiErrors = opts?.ignoreLeaveApiErrors !== false;
    setExitingRoom(true);
    try {
      await api.leaveBuddySession(sessionId);
      onExit();
    } catch (err) {
      if (ignoreLeaveApiErrors) {
        onExit();
        return;
      }
      setExitingRoom(false);
      throw err;
    }
  };

  const completeAndExitLegacy = async () => {
    try {
      await api.buddyParticipantComplete(sessionId);
      await leave({ ignoreLeaveApiErrors: false });
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not finish session step"));
    }
  };

  return {
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
    resetForSession,
  };
}
