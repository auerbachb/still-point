import { useAudioUnlock } from "@/lib/useAudioUnlock";

export function useBuddyAudioUnlock(sessionId: string) {
  return useAudioUnlock(sessionId);
}
