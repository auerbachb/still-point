import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockAudioParam {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class MockNode {
  connect() {}
}

class MockBufferSource extends MockNode {
  buffer: unknown = null;
  start() {}
  stop() {}
}

class MockAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = new MockNode();

  createBufferSource() {
    return new MockBufferSource();
  }
  createBuffer() {
    return {};
  }
  async decodeAudioData() {
    return { duration: 0.5, numberOfChannels: 1, sampleRate: 44100 };
  }
}

type AudioModule = typeof import("./audio");

async function loadAudio(): Promise<AudioModule> {
  vi.resetModules();
  (globalThis as { window?: unknown }).window = {
    AudioContext: MockAudioContext as unknown as typeof AudioContext,
  };
  return import("./audio");
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
});

describe("SoundPrefs voiceCountdown", () => {
  it("defaults voiceCountdown to false", async () => {
    const { loadSoundPrefs } = await loadAudio();
    expect(loadSoundPrefs().voiceCountdown).toBe(false);
  });

  it("merges stored voiceCountdown preference", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    const { loadSoundPrefs } = await loadAudio();
    localStorage.setItem(
      "stillpoint_sound_prefs",
      JSON.stringify({ voiceCountdown: true }),
    );
    expect(loadSoundPrefs().voiceCountdown).toBe(true);
  });
});

describe("voice countdown playback", () => {
  it("builds asset paths for seconds 1–60", async () => {
    const { voiceCountdownAssetPath, VOICE_COUNTDOWN_MAX } = await loadAudio();
    expect(VOICE_COUNTDOWN_MAX).toBe(60);
    expect(voiceCountdownAssetPath(30)).toBe("/audio/voice-countdown/30.mp3");
  });

  it("playVoiceCountdown returns false for out-of-range seconds", async () => {
    const { playVoiceCountdown } = await loadAudio();
    expect(playVoiceCountdown(0)).toBe(false);
    expect(playVoiceCountdown(61)).toBe(false);
  });

  it("playVoiceCountdown plays after buffer is preloaded", async () => {
    const { preloadVoiceCountdown, playVoiceCountdown } = await loadAudio();
    await preloadVoiceCountdown();
    expect(playVoiceCountdown(10)).toBe(true);
  });
});
