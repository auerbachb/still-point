import { useCallback, useEffect, useRef, useState } from "react";
import { loadSoundPrefs, saveSoundPrefs, preloadVoiceCountdown, cancelVoiceCountdownPlayback, unlockAudioContext, type SoundPrefs } from "@/lib/audio";

export function useBuddyAudioUnlock(sessionId: string) {
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefs());
  const soundPrefsRef = useRef(soundPrefs);
  soundPrefsRef.current = soundPrefs;
  const audioUnlockRequestRef = useRef(0);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    audioUnlockRequestRef.current += 1;
    setAudioBlocked(false);
  }, [sessionId]);

  useEffect(() => {
    if (soundPrefs.voiceCountdown) {
      void preloadVoiceCountdown();
    } else {
      cancelVoiceCountdownPlayback();
    }
  }, [soundPrefs.voiceCountdown]);

  const handleSoundPlaybackBlocked = useCallback(() => {
    setAudioBlocked(true);
  }, []);

  const handleSoundPrefToggle = useCallback((key: keyof SoundPrefs) => {
    const current = soundPrefsRef.current;
    const next = { ...current, [key]: !current[key] };
    const hasEnabledSound = Object.values(next).some(Boolean);
    soundPrefsRef.current = next;
    setSoundPrefs(next);
    saveSoundPrefs(next);

    const requestId = ++audioUnlockRequestRef.current;
    if (!hasEnabledSound) {
      setAudioBlocked(false);
      return;
    }

    if (!next[key]) {
      return;
    }

    void unlockAudioContext().then((unlockResult) => {
      if (requestId !== audioUnlockRequestRef.current) return;
      const stillHasEnabledSound = Object.values(soundPrefsRef.current).some(Boolean);
      setAudioBlocked(stillHasEnabledSound && unlockResult === "blocked");
    });
  }, []);

  const handleEnableLocalAudio = useCallback(async () => {
    const requestId = ++audioUnlockRequestRef.current;
    const unlockResult = await unlockAudioContext();
    if (requestId === audioUnlockRequestRef.current) {
      const hasEnabledSound = Object.values(soundPrefsRef.current).some(Boolean);
      if (hasEnabledSound) {
        setAudioBlocked(unlockResult === "blocked");
      } else {
        setAudioBlocked(false);
      }
    }
  }, []);

  return {
    soundPrefs,
    audioBlocked,
    handleSoundPlaybackBlocked,
    handleSoundPrefToggle,
    handleEnableLocalAudio,
  };
}
