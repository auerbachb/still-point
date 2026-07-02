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

/** Bell chime — repeated `count` times for minute announcements */
export function playChime(count: number): boolean {
  const ctx = getPlayableAudioContext();
  if (!ctx) return false;

  for (let i = 0; i < count; i++) {
    const startTime = ctx.currentTime + i * 0.4;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(1200, startTime);
    osc.frequency.exponentialRampToValueAtTime(800, startTime + 0.3);

    gain.gain.setValueAtTime(0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.5);
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
      await Promise.all(loads);
    })();
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
};

const STORAGE_KEY = "stillpoint_sound_prefs";

const DEFAULTS: SoundPrefs = {
  tick: false,
  chime: true,
  completion: true,
  voiceCountdown: false,
};

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
