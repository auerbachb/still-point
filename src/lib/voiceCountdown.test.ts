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
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    super();
    MockBufferSource.created.push(this);
  }
  static created: MockBufferSource[] = [];
}

class MockAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  destination = new MockNode();
  addEventListener() {}
  removeEventListener() {}

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

function stubSuccessfulFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
}

beforeEach(() => {
  MockBufferSource.created = [];
  stubSuccessfulFetch();
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
    expect(MockBufferSource.created).toHaveLength(1);
    expect(MockBufferSource.created[0].start).toHaveBeenCalledTimes(1);
  });

  it("does not start an uncached clip until the file loads", async () => {
    let release: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const { playVoiceCountdown } = await loadAudio();
    expect(playVoiceCountdown(10)).toBe(true);
    expect(MockBufferSource.created).toHaveLength(0);

    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await vi.waitFor(() => {
      expect(MockBufferSource.created).toHaveLength(1);
    });
    expect(MockBufferSource.created[0].start).toHaveBeenCalledTimes(1);
  });

  it("cancel before the clip loads never starts it", async () => {
    let release: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const { playVoiceCountdown, cancelVoiceCountdownPlayback } = await loadAudio();
    expect(playVoiceCountdown(10)).toBe(true);
    cancelVoiceCountdownPlayback();
    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(MockBufferSource.created).toHaveLength(0);
  });

  it("cancel stops a clip that is already playing", async () => {
    const { preloadVoiceCountdown, playVoiceCountdown, cancelVoiceCountdownPlayback } =
      await loadAudio();
    await preloadVoiceCountdown();
    expect(playVoiceCountdown(10)).toBe(true);
    const source = MockBufferSource.created[0];
    cancelVoiceCountdownPlayback();
    expect(source.stop).toHaveBeenCalledTimes(1);
  });

  it("plays again after cancel", async () => {
    const { preloadVoiceCountdown, playVoiceCountdown, cancelVoiceCountdownPlayback } =
      await loadAudio();
    await preloadVoiceCountdown();
    playVoiceCountdown(10);
    cancelVoiceCountdownPlayback();
    expect(playVoiceCountdown(9)).toBe(true);
    expect(MockBufferSource.created).toHaveLength(2);
    expect(MockBufferSource.created[1].start).toHaveBeenCalledTimes(1);
  });
});
