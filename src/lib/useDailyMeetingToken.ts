import { useEffect, useState } from "react";
import { api, ApiError, type BuddySnapshot } from "@/lib/api";

export function useDailyMeetingToken(sessionId: string, snap: BuddySnapshot | null) {
  const [dailyMeetingToken, setDailyMeetingToken] = useState<string | null>(null);
  const [dailyTokenError, setDailyTokenError] = useState<string | null>(null);

  useEffect(() => {
    setDailyMeetingToken(null);
    setDailyTokenError(null);
  }, [sessionId]);

  useEffect(() => {
    if (snap?.state !== "active" || !snap.dailyRoomUrl?.trim()) {
      setDailyMeetingToken(null);
      setDailyTokenError(null);
      return;
    }
    let cancelled = false;
    setDailyMeetingToken(null);
    setDailyTokenError(null);
    void api.getBuddyMeetingToken(sessionId).then(
      (r) => {
        if (!cancelled) setDailyMeetingToken(r.token);
      },
      (e) => {
        if (!cancelled) {
          setDailyTokenError(
            e instanceof ApiError ? e.message : "Could not get video token",
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, snap?.state, snap?.dailyRoomUrl]);

  return { dailyMeetingToken, dailyTokenError };
}
