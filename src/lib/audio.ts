// Web Audio API utilities for session sounds
// All sounds are synthesized — no external files needed

let audioCtx: AudioContext | null = null;

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
  // Prime within the user gesture first — this is what actually unlocks audio
  // for a buddy whose context never received a sound-producing gesture.
  primeAudioContext(ctx);
  if (ctx.state !== "running") {
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
};

const STORAGE_KEY = "stillpoint_sound_prefs";

const DEFAULTS: SoundPrefs = {
  tick: false,
  chime: true,
  completion: true,
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
