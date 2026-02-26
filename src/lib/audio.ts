// Web Audio API utilities for session sounds
// All sounds are synthesized — no external files needed

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browsers require user gesture)
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Short, soft tick — like a clock */
export function playTick() {
  const ctx = getAudioContext();
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
}

/** Bell chime — repeated `count` times for minute announcements */
export function playChime(count: number) {
  const ctx = getAudioContext();

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
}

/** Completion sound — a warm, resonant tone */
export function playCompletion() {
  const ctx = getAudioContext();

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
