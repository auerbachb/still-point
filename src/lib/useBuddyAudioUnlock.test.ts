/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioUnlockResult, SoundPrefs } from "./audio";

const STORAGE_KEY = "stillpoint_sound_prefs";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Every pending `unlockAudioContext()` call, newest last, so a test can hold an
 * unlock open across another toggle and settle it afterwards. That gap is the
 * whole subject here: the hook's cancellation token is only correct if a toggle
 * that starts no unlock of its own leaves an in-flight one alone.
 */
const pendingUnlocks: Array<(result: AudioUnlockResult) => void> = [];

vi.mock("@/lib/audio", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./audio")>();
  return {
    ...actual,
    // Only the three side-effecting entry points are stubbed; `hasEnabledAudio`
    // and `soundPrefUsesAudio` stay real, since which prefs count as audio is
    // exactly the classification under test.
    unlockAudioContext: vi.fn(
      () =>
        new Promise<AudioUnlockResult>((resolve) => {
          pendingUnlocks.push(resolve);
        }),
    ),
    preloadVoiceCountdown: vi.fn(async () => {}),
    cancelVoiceCountdownPlayback: vi.fn(),
  };
});

const { useBuddyAudioUnlock } = await import("./useBuddyAudioUnlock");

/**
 * jsdom 29 under Vitest 4 exposes a `window` with no `localStorage`, so the
 * suite supplies its own conforming Storage (same shim as `useWakeLock.test.ts`).
 */
function installMemoryStorage(): void {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

/** Seeds stored prefs so each test starts from a stated, not a default, state. */
function seedPrefs(prefs: Partial<SoundPrefs>): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      tick: false,
      chime: false,
      completion: false,
      voiceCountdown: false,
      haptics: false,
      ...prefs,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

type HookHandle<R> = {
  current: () => R;
  unmount: () => Promise<void>;
};

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

async function renderHook<R>(hook: () => R): Promise<HookHandle<R>> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let latest: R;

  function Probe() {
    latest = hook();
    return null;
  }

  const handle: HookHandle<R> = {
    current: () => latest,
    // Idempotent, so an explicit unmount and the afterEach sweep can both run.
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  liveViews.push(handle);

  await act(async () => {
    root = createRoot(container);
  });
  await act(async () => {
    root?.render(createElement(Probe));
  });

  return handle;
}

beforeEach(() => {
  pendingUnlocks.length = 0;
  installMemoryStorage();
});

afterEach(async () => {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  vi.clearAllMocks();
});

describe("useBuddyAudioUnlock", () => {
  it("still reports blocked audio when haptics is toggled mid-unlock (#712)", async () => {
    seedPrefs({});
    const view = await renderHook(() => useBuddyAudioUnlock("session-1"));

    // Enabling an audio cue starts an unlock that has not settled yet.
    await act(async () => {
      view.current().handleSoundPrefToggle("chime");
    });
    expect(pendingUnlocks).toHaveLength(1);

    // Haptics needs no audio context, so this toggle starts no unlock of its
    // own. It must therefore not invalidate the chime unlock still in flight.
    await act(async () => {
      view.current().handleSoundPrefToggle("haptics");
    });
    expect(pendingUnlocks).toHaveLength(1);

    await act(async () => {
      pendingUnlocks[0]("blocked");
    });

    // The regression this guards: the discarded result left the sitter with the
    // chime on, audio genuinely blocked, and no warning saying so.
    expect(view.current().audioBlocked).toBe(true);
  });

  it("keeps the warning cleared when the last audio cue is switched off mid-unlock", async () => {
    seedPrefs({});
    const view = await renderHook(() => useBuddyAudioUnlock("session-2"));

    await act(async () => {
      view.current().handleSoundPrefToggle("chime");
    });
    expect(pendingUnlocks).toHaveLength(1);

    // Chime back off: no audio cue is left, so the in-flight unlock is
    // cancelled and its late "blocked" result must not raise a warning about
    // sound the sitter has just silenced.
    await act(async () => {
      view.current().handleSoundPrefToggle("chime");
    });

    await act(async () => {
      pendingUnlocks[0]("blocked");
    });

    expect(view.current().audioBlocked).toBe(false);
  });

  it("leaves audio locked when only haptics is enabled", async () => {
    seedPrefs({});
    const view = await renderHook(() => useBuddyAudioUnlock("session-3"));

    await act(async () => {
      view.current().handleSoundPrefToggle("haptics");
    });

    // The point of the pref: a sitter who wants vibration and silence never
    // has their audio context woken, so nothing can duck their music.
    expect(pendingUnlocks).toHaveLength(0);
    expect(view.current().audioBlocked).toBe(false);
    expect(view.current().soundPrefs.haptics).toBe(true);
  });
});
