import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadSoundPrefs,
  saveSoundPrefs,
  preloadVoiceCountdown,
  cancelVoiceCountdownPlayback,
  unlockAudioContext,
  hasEnabledAudio,
  soundPrefUsesAudio,
  type SoundPrefs,
} from "@/lib/audio";

/**
 * Local sound prefs plus the "browser audio is paused" flag.
 * Shared by solo and buddy sessions. `resetKey` clears a stale blocked flag
 * when the sit changes (buddy session id, or a new solo mount key).
 */
export function useAudioUnlock(resetKey: string) {
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefs());
  const soundPrefsRef = useRef(soundPrefs);
  soundPrefsRef.current = soundPrefs;
  const audioUnlockRequestRef = useRef(0);
  const [audioBlocked, setAudioBlocked] = useState(false);

  useEffect(() => {
    audioUnlockRequestRef.current += 1;
    setAudioBlocked(false);
  }, [resetKey]);

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

  const handleSoundPlaybackResumed = useCallback(() => {
    // A recovered context supersedes an unlock that has not settled yet.
    // Its late "blocked" result must not put the warning back up.
    audioUnlockRequestRef.current += 1;
    setAudioBlocked(false);
  }, []);

  const handleSoundPrefToggle = useCallback((key: keyof SoundPrefs) => {
    const current = soundPrefsRef.current;
    const next = { ...current, [key]: !current[key] };
    const hasEnabledSound = hasEnabledAudio(next);
    soundPrefsRef.current = next;
    setSoundPrefs(next);
    saveSoundPrefs(next);

    if (!hasEnabledSound) {
      // Every audio cue is off now, so cancel any unlock still in flight: its
      // late "blocked" result must not raise a warning about sound the sitter
      // has just silenced.
      audioUnlockRequestRef.current += 1;
      setAudioBlocked(false);
      return;
    }

    if (!next[key]) {
      return;
    }

    // #712: enabling a non-audio pref (haptics) must not unlock the audio
    // context. Vibration needs none, and the sitter reaching for it is the one
    // who wants silence.
    if (!soundPrefUsesAudio(key)) {
      return;
    }

    // Claimed only on the path that actually starts an unlock. Bumping it on
    // the early returns above would cancel an in-flight unlock without starting
    // a replacement — the pending "blocked" result would be dropped on arrival
    // and the audio warning would stay wrong for cues that really are blocked.
    const requestId = ++audioUnlockRequestRef.current;
    void unlockAudioContext().then((unlockResult) => {
      if (requestId !== audioUnlockRequestRef.current) return;
      const stillHasEnabledSound = hasEnabledAudio(soundPrefsRef.current);
      setAudioBlocked(stillHasEnabledSound && unlockResult === "blocked");
    });
  }, []);

  const handleEnableLocalAudio = useCallback(async () => {
    const requestId = ++audioUnlockRequestRef.current;
    const unlockResult = await unlockAudioContext();
    if (requestId === audioUnlockRequestRef.current) {
      const hasEnabledSound = hasEnabledAudio(soundPrefsRef.current);
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
    handleSoundPlaybackResumed,
    handleSoundPrefToggle,
    handleEnableLocalAudio,
  };
}
