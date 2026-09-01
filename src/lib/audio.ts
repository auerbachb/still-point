// Web Audio API utilities for session sounds
// Tick/chime/completion are synthesized; voice countdown uses pre-generated clips.

let audioCtx: AudioContext | null = null;

/** Remaining-second values with pre-generated voice clips (final minute). */
export const VOICE_COUNTDOWN_MAX = 60;

export const voiceCountdownAssetPath = (seconds: number) =>
  `/audio/voice-countdown/${seconds}.mp3`;

const voiceBuffers = new Map<number, AudioBuffer>();
let voicePreloadPromise: Promise<void> | null = null;
let voicePlaybackEpoch = 0;
let lastVoiceCountdownPlayedSec = 61;

/** Drop any in-flight voice countdown playback queued by async buffer loads. */
export function cancelVoiceCountdownPlayback(): void {
  voicePlaybackEpoch++;
  lastVoiceCountdownPlayedSec = 61;
}

export type AudioUnlockResult = "unlocked" | "blocked" | "unavailable";

type WindowWithWebAudio = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

function getAudioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const webAudioWindow = window as WindowWithWebAudio;
  return webAudioWindow.AudioContext ?? webAudioWindow.webkitAudioContext;
}

function getAudioContext(): AudioContext | null {
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextCtor();
  }
  return audioCtx;
}

function readAudioContextState(ctx: AudioContext): AudioContextState {
  return ctx.state;
}

/**
 * Starts an inaudible 1-sample buffer on the context. On iOS Safari and other
 * strict-autoplay browsers, calling `resume()` alone resolves but leaves the
 * context unable to produce sound — a node must actually be started from inside
 * the user gesture for playback to unlock. This must run synchronously within
 * the gesture (before any `await`) to count as gesture-initiated.
 */
function primeAudioContext(ctx: AudioContext): void {
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Best-effort: priming failures shouldn't block the resume() path.
  }
}

export async function unlockAudioContext(): Promise<AudioUnlockResult> {
  const ctx = getAudioContext();
  if (!ctx) return "unavailable";
  if (ctx.state !== "running") {
    // Prime within the user gesture before resuming — starting a node is what
    // actually unlocks audio for a buddy whose context never received a
    // sound-producing gesture. Skipped once the context is already running.
    primeAudioContext(ctx);
    try {
      await ctx.resume();
    } catch {
      return "blocked";
    }
  }
  return readAudioContextState(ctx) === "running" ? "unlocked" : "blocked";
}

/**
 * Resumes an already-created context without priming it.
 *
 * Browsers suspend the `AudioContext` when the tab is backgrounded or the screen
 * locks, and nothing resumed it — so a tick that stopped mid-session never came
 * back (#710). Unlike `unlockAudioContext()` this needs no user gesture: it does
 * not prime a node and it never creates a context, so it cannot bring one into
 * existence outside a gesture (which would leave it permanently suspended on
 * strict-autoplay browsers).
 *
 * Returns true when the context is running afterwards. A context that was never
 * created, or one the browser still refuses to resume, returns false — the
 * gesture-driven `unlockAudioContext()` remains the recovery path for those.
 */
export async function resumeAudioContext(): Promise<boolean> {
  // Deliberately reads `audioCtx` rather than calling `getAudioContext()`.
  if (!audioCtx) return false;
  if (audioCtx.state === "running") return true;
  try {
    await audioCtx.resume();
  } catch {
    return false;
  }
  return readAudioContextState(audioCtx) === "running";
}

function getPlayableAudioContext(): AudioContext | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state === "running") return ctx;
  return null;
}

/** Short, soft tick — like a clock */
export function playTick(): boolean {
  const ctx = getPlayableAudioContext();
  if (!ctx) return false;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.06);
  return true;
}

/**
 * Length of the whole minute-marker bell (#711).
 *
 * The old chime was a 0.5s strike replayed once per remaining minute at 400ms
 * spacing, so a 20-minute sit opened with a 7.7s, 19-strike run — the "song"
 * that read as disruptive. This is a single 0.25s strike: exactly half of one
 * old strike, and no repeats at all.
 */
const CHIME_DURATION_S = 0.25;
/** Onset ramp — long enough to take the click off the strike, short enough to still read as one. */
const CHIME_ATTACK_S = 0.004;
/**
 * Partials of one struck bell. The 2.7x upper partial is deliberately
 * inharmonic (bell, not organ pipe) and dies inside the first ~90ms, leaving
 * the fundamental to ring out. Peaks sum to 0.15 — the same peak the old
 * single strike used, so the marker is no louder than before.
 *
 * Fixed frequencies, rather than the old 1200 -> 800Hz glide, are what let the
 * iOS sample generator reproduce this exactly. Keep in sync with `ChimeSynth`
 * in `ios/StillPointShared/Sources/StillPointShared/ChimeSynth.swift`.
 */
const CHIME_PARTIALS = [
  { frequency: 880, peak: 0.115, decay: CHIME_DURATION_S },
  { frequency: 2376, peak: 0.035, decay: 0.09 },
] as const;

/** Minute-marker bell — one strike, never repeated. */
export function playChime(): boolean {
  const ctx = getPlayableAudioContext();
  if (!ctx) return false;

  const startTime = ctx.currentTime;

  for (const { frequency, peak, decay } of CHIME_PARTIALS) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;

    // Soft attack, then an exponential tail to near-silence like a struck bell.
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + CHIME_ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + decay);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + CHIME_DURATION_S);
  }
  return true;
}

/** Decode and cache one voice countdown clip. */
async function fetchVoiceBuffer(seconds: number): Promise<AudioBuffer | null> {
  const ctx = getAudioContext();
  if (!ctx) return null;

  const cached = voiceBuffers.get(seconds);
  if (cached) return cached;

  try {
    const res = await fetch(voiceCountdownAssetPath(seconds));
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data.slice(0));
    voiceBuffers.set(seconds, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/** Preload all final-minute voice clips (call when voice countdown is enabled). */
export function preloadVoiceCountdown(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!voicePreloadPromise) {
    voicePreloadPromise = (async () => {
      const loads = Array.from({ length: VOICE_COUNTDOWN_MAX }, (_, i) =>
        fetchVoiceBuffer(VOICE_COUNTDOWN_MAX - i),
      );
      const buffers = await Promise.all(loads);
      if (buffers.some(buffer => !buffer)) {
        throw new Error("voice countdown preload incomplete");
      }
    })().catch(() => {
      voicePreloadPromise = null;
    });
  }
  return voicePreloadPromise;
}

/** Play a preloaded voice clip for remaining seconds (1–60). */
export function playVoiceCountdown(seconds: number): boolean {
  if (seconds < 1 || seconds > VOICE_COUNTDOWN_MAX) return false;
  const ctx = getPlayableAudioContext();
  if (!ctx) return false;

  const buffer = voiceBuffers.get(seconds);
  if (!buffer) {
    const epoch = voicePlaybackEpoch;
    void fetchVoiceBuffer(seconds).then((loaded) => {
      if (
        loaded &&
        epoch === voicePlaybackEpoch &&
        seconds <= lastVoiceCountdownPlayedSec
      ) {
        playVoiceCountdown(seconds);
      }
    });
    return true;
  }

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(ctx.currentTime);
    lastVoiceCountdownPlayedSec = seconds;
    return true;
  } catch {
    return false;
  }
}

/** Completion sound — a warm, resonant tone */
export function playCompletion(): boolean {
  const ctx = getPlayableAudioContext();
  if (!ctx) return false;

  // Layer two harmonics for a richer sound
  const freqs = [528, 660];
  for (const freq of freqs) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 2.5);
  }
  return true;
}

// --- Sound preferences (localStorage) ---

export type SoundPrefs = {
  tick: boolean;
  chime: boolean;
  completion: boolean;
  /** Spoken final-minute countdown (1–60); suppresses tick/chime while active. */
  voiceCountdown: boolean;
  /**
   * #712: vibrate at each minute marker and at the end of the sit, for someone
   * sitting with their eyes closed who wants no sound at all. Off by default —
   * an unasked-for buzz mid-sit is worse than silence. Not an audio channel:
   * see `src/lib/haptics.ts`.
   */
  haptics: boolean;
};

const STORAGE_KEY = "stillpoint_sound_prefs";

const DEFAULTS: SoundPrefs = {
  tick: false,
  chime: true,
  completion: true,
  voiceCountdown: false,
  haptics: false,
};

/**
 * Which prefs actually play through the audio context.
 *
 * #712: `haptics` vibrates the device and needs no `AudioContext`, so it must
 * never make a caller unlock audio or conclude that a sitter has sound on — the
 * pref exists precisely for someone who wants none. Counting it would warm an
 * audio session for that sitter (which can duck whatever else the device is
 * playing) and raise the "browser audio is paused" banner over silence they
 * chose.
 *
 * Spelled as a total `Record` rather than a list of audio keys so that adding a
 * field to `SoundPrefs` fails typecheck until it is classified here, instead of
 * being silently swept in by an `Object.values(prefs).some(Boolean)`.
 *
 * iOS counterpart: `SoundToggleLogic.effects(toggledKeyUsesAudio:)`.
 */
const SOUND_PREF_USES_AUDIO: Record<keyof SoundPrefs, boolean> = {
  tick: true,
  chime: true,
  completion: true,
  voiceCountdown: true,
  haptics: false,
};

/** Whether toggling `key` on should unlock/warm the audio context (#712). */
export function soundPrefUsesAudio(key: keyof SoundPrefs): boolean {
  return SOUND_PREF_USES_AUDIO[key];
}

/**
 * Whether any pref that actually produces sound is on.
 *
 * Use this instead of `Object.values(prefs).some(Boolean)`, which counts
 * `haptics` and so treats a silent, vibration-only sitter as having sound (#712).
 */
export function hasEnabledAudio(prefs: SoundPrefs): boolean {
  return (Object.keys(SOUND_PREF_USES_AUDIO) as (keyof SoundPrefs)[]).some(
    (key) => SOUND_PREF_USES_AUDIO[key] && prefs[key],
  );
}

export function loadSoundPrefs(): SoundPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSoundPrefs(prefs: SoundPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
