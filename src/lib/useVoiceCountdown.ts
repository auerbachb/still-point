import { useEffect } from "react";
import { preloadVoiceCountdown } from "@/lib/audio";

/** Preloads final-minute voice clips when the preference is enabled. */
export function useVoiceCountdown(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void preloadVoiceCountdown();
  }, [enabled]);
}
