/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveWakeLockPrefs } from "./wakeLockPrefs";
import { useKeepScreenAwakePref, useWakeLock } from "./useWakeLock";

const STORAGE_KEY = "stillpoint_wake_lock_prefs";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom 29 under Vitest 4 exposes a `window` with no `localStorage`, so the
 * suite supplies its own conforming Storage (same shim as `cachedUser.test.ts`).
 * `wakeLockPrefs` reads the global at call time, never at import, so installing
 * it per test is enough and the production path is unchanged.
 */
function installMemoryStorage(): Storage {
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
  return storage;
}

/* -------------------------------------------------------------------------- */
/* Fake Wake Lock API                                                          */
/* -------------------------------------------------------------------------- */

type FakeSentinel = WakeLockSentinel & { released: boolean };

/**
 * Minimal stand-in for a real `WakeLockSentinel`: the hook only ever reads
 * `.released` and calls `.release()`, so the unused EventTarget surface is cast
 * away rather than stubbed.
 */
function makeSentinel(): FakeSentinel {
  const sentinel = {
    released: false,
    type: "screen" as const,
    release: vi.fn(async () => {
      sentinel.released = true;
    }),
  };
  return sentinel as unknown as FakeSentinel;
}

type WakeLockMock = {
  request: ReturnType<typeof vi.fn>;
  sentinels: FakeSentinel[];
};

/**
 * Installs `navigator.wakeLock` with a request() that resolves immediately.
 * Every granted sentinel is recorded so tests can assert on release calls.
 */
function installWakeLock(): WakeLockMock {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    const sentinel = makeSentinel();
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
  return { request, sentinels };
}

/** Removes `navigator.wakeLock` so `isWakeLockSupported()` reports false. */
function removeWakeLock(): void {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "wakeLock");
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

async function fireVisibilityChange(state: DocumentVisibilityState): Promise<void> {
  setVisibility(state);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

type HookHandle<P, R> = {
  /** Latest value returned by the hook. */
  current: () => R;
  rerender: (props: P) => Promise<void>;
  unmount: () => Promise<void>;
};

/**
 * Every handle `renderHook` hands out, so `afterEach` can tear down anything a
 * failed assertion left mounted. Without this, a leaked root keeps its
 * `visibilitychange` listener registered and drives the *next* test's wake-lock
 * mock, turning one real failure into a cascade of misleading ones.
 */
const liveViews: Array<{ unmount: () => Promise<void> }> = [];

async function renderHook<P, R>(
  hook: (props: P) => R,
  // `NoInfer` keeps a literal first argument (e.g. `true`) from narrowing `P`,
  // so `rerender(false)` stays assignable.
  initialProps: NoInfer<P>,
): Promise<HookHandle<P, R>> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let latest: R;

  function Probe({ props }: { props: P }) {
    latest = hook(props);
    return null;
  }

  const render = async (props: P) => {
    await act(async () => {
      root?.render(createElement(Probe, { props }));
    });
  };

  // Idempotent: a second call finds `root` null and the container detached, so
  // the explicit `await view.unmount()` in a test and the `afterEach` sweep can
  // both run without double-unmounting.
  const handle: HookHandle<P, R> = {
    current: () => latest,
    rerender: render,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  // Registered before the first render: if mounting the hook throws, the sweep
  // still owns the container (and the root, once created) and can tear it down.
  liveViews.push(handle);

  await act(async () => {
    root = createRoot(container);
  });
  await render(initialProps);

  return handle;
}

/* -------------------------------------------------------------------------- */

beforeEach(() => {
  setVisibility("visible");
  installMemoryStorage();
});

afterEach(async () => {
  // Unmount first: the hook's cleanup releases its sentinel, which still needs
  // the mock this test installed. Each teardown is isolated so one rejection
  // can't strand the remaining views or skip the mock restoration below —
  // but it is re-thrown afterwards rather than swallowed, since a failing
  // unmount is itself a real signal.
  const teardownErrors: unknown[] = [];
  for (const view of liveViews.splice(0)) {
    try {
      await view.unmount();
    } catch (error) {
      teardownErrors.push(error);
    }
  }
  removeWakeLock();
  vi.restoreAllMocks();
  if (teardownErrors.length > 0) throw teardownErrors[0];
});

describe("useWakeLock", () => {
  it("acquires a screen wake lock when enabled and the page is visible", async () => {
    const wakeLock = installWakeLock();

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    expect(wakeLock.request).toHaveBeenCalledWith("screen");
    expect(wakeLock.sentinels[0].released).toBe(false);

    await view.unmount();
  });

  it("does not acquire while disabled", async () => {
    const wakeLock = installWakeLock();

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), false);

    expect(wakeLock.request).not.toHaveBeenCalled();

    await view.unmount();
  });

  it("acquires when enabled flips true (the sit actually starting)", async () => {
    const wakeLock = installWakeLock();

    // The production trigger: SessionView mounts idle, then `isActive` flips.
    // Mounting straight into `true` exercises a different entry into the effect.
    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), false);
    expect(wakeLock.request).not.toHaveBeenCalled();

    await view.rerender(true);

    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    expect(wakeLock.request).toHaveBeenCalledWith("screen");
    expect(wakeLock.sentinels[0].released).toBe(false);

    await view.unmount();
  });

  it("releases the lock when enabled flips false (pause, complete, abandon, toggle-off)", async () => {
    const wakeLock = installWakeLock();

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    expect(wakeLock.sentinels).toHaveLength(1);

    await view.rerender(false);

    expect(wakeLock.sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(wakeLock.sentinels[0].released).toBe(true);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    await view.unmount();
  });

  it("releases the lock on unmount (navigating away mid-sit)", async () => {
    const wakeLock = installWakeLock();

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    await view.unmount();

    expect(wakeLock.sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(wakeLock.sentinels[0].released).toBe(true);
  });

  it("re-acquires when the page becomes visible after the browser auto-released", async () => {
    const wakeLock = installWakeLock();

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    // Browsers auto-release the lock when the page is hidden.
    wakeLock.sentinels[0].released = true;
    await fireVisibilityChange("hidden");
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    await fireVisibilityChange("visible");

    expect(wakeLock.request).toHaveBeenCalledTimes(2);
    expect(wakeLock.sentinels[1].released).toBe(false);

    await view.unmount();
  });

  it("does not re-request while a live sentinel is still held", async () => {
    const wakeLock = installWakeLock();

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    // Sentinel is still live (not auto-released) — a redundant visibility event
    // must not stack a second lock.
    await fireVisibilityChange("visible");

    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    await view.unmount();
  });

  it("defers acquisition while the page starts hidden, then acquires on return", async () => {
    const wakeLock = installWakeLock();
    setVisibility("hidden");

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    expect(wakeLock.request).not.toHaveBeenCalled();

    await fireVisibilityChange("visible");
    expect(wakeLock.request).toHaveBeenCalledTimes(1);

    await view.unmount();
  });

  it("no-ops on browsers without the Wake Lock API (older Safari/Firefox)", async () => {
    removeWakeLock();
    const onVisibility = vi.spyOn(document, "addEventListener");

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);

    // No listener registered, and unmounting must not throw.
    expect(
      onVisibility.mock.calls.filter(([type]) => type === "visibilitychange"),
    ).toHaveLength(0);
    await expect(view.unmount()).resolves.toBeUndefined();
  });

  it("swallows a rejected request (e.g. low battery) without breaking the sit", async () => {
    const request = vi.fn(async () => {
      throw new DOMException("Wake Lock denied", "NotAllowedError");
    });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);

    expect(request).toHaveBeenCalledTimes(1);
    // The session flow continues: no unhandled rejection, clean unmount.
    await expect(view.unmount()).resolves.toBeUndefined();
  });

  it("retries after a rejected request when the page becomes visible again", async () => {
    const sentinel = makeSentinel();
    const request = vi
      .fn<() => Promise<WakeLockSentinel>>()
      .mockRejectedValueOnce(new DOMException("Wake Lock denied", "NotAllowedError"))
      .mockResolvedValueOnce(sentinel);
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    expect(request).toHaveBeenCalledTimes(1);

    await fireVisibilityChange("visible");

    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinel.released).toBe(false);

    await view.unmount();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping acquires so no sentinel is orphaned", async () => {
    const pending: Array<(sentinel: FakeSentinel) => void> = [];
    const request = vi.fn(
      () => new Promise<WakeLockSentinel>((resolve) => pending.push(resolve as never)),
    );
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    // Mount kicked off one in-flight request; a quick visibility event must not
    // start a second while the first is unresolved.
    await fireVisibilityChange("visible");
    expect(request).toHaveBeenCalledTimes(1);

    const first = makeSentinel();
    await act(async () => {
      pending[0](first);
    });
    expect(first.released).toBe(false);

    await view.unmount();
    expect(first.release).toHaveBeenCalledTimes(1);
  });

  it("releases a sentinel that arrives after teardown", async () => {
    const pending: Array<(sentinel: FakeSentinel) => void> = [];
    const request = vi.fn(
      () => new Promise<WakeLockSentinel>((resolve) => pending.push(resolve as never)),
    );
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });

    const view = await renderHook((enabled: boolean) => useWakeLock(enabled), true);
    await view.unmount();

    const late = makeSentinel();
    await act(async () => {
      pending[0](late);
    });

    // The effect was already torn down: the late lock must not stay held.
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(late.released).toBe(true);
  });
});

describe("useKeepScreenAwakePref", () => {
  it("reads the stored opt-in", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepScreenAwakeDuringSession: true }));

    const view = await renderHook(() => useKeepScreenAwakePref(), undefined);

    expect(view.current()).toBe(true);
    await view.unmount();
  });

  it("defaults to true when nothing is stored (#730 opt-out parity with iOS)", async () => {
    const view = await renderHook(() => useKeepScreenAwakePref(), undefined);

    expect(view.current()).toBe(true);
    await view.unmount();
  });

  // The half the default flip could quietly break: a stored `false` is a choice,
  // not an absent value, so it must not be re-read as "unset".
  it("respects an explicit stored off rather than applying the new default", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepScreenAwakeDuringSession: false }));

    const view = await renderHook(() => useKeepScreenAwakePref(), undefined);

    expect(view.current()).toBe(false);
    await view.unmount();
  });

  it("re-renders when the Settings toggle saves in the same tab", async () => {
    // Starts from an explicit opt-out so the observed change is the toggle, not
    // the default.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepScreenAwakeDuringSession: false }));

    const view = await renderHook(() => useKeepScreenAwakePref(), undefined);
    expect(view.current()).toBe(false);

    await act(async () => {
      saveWakeLockPrefs({ keepScreenAwakeDuringSession: true });
    });

    expect(view.current()).toBe(true);
    await view.unmount();
  });

  it("re-renders when the Settings toggle saves off mid-session", async () => {
    // The hook's stated contract: "an already-mounted session releases its lock
    // on toggle-off". Paired with the `enabled` true->false release test above,
    // this pins the half that a live session actually consumes.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepScreenAwakeDuringSession: true }));

    const view = await renderHook(() => useKeepScreenAwakePref(), undefined);
    expect(view.current()).toBe(true);

    await act(async () => {
      saveWakeLockPrefs({ keepScreenAwakeDuringSession: false });
    });

    expect(view.current()).toBe(false);
    await view.unmount();
  });

  it("re-renders on a cross-tab storage event", async () => {
    const view = await renderHook(() => useKeepScreenAwakePref(), undefined);
    expect(view.current()).toBe(true);

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepScreenAwakeDuringSession: false }));
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(view.current()).toBe(false);
    await view.unmount();
  });
});

/**
 * The composition the session screens actually run — `useWakeLock(pref && isActive)`
 * in `SessionView`, `BuddySessionRoom`, and `BreathCountView`. Pinned here because
 * #730's acceptance is about that pairing, not either hook alone: the default is
 * only meaningful if an untouched install really acquires the lock mid-sit.
 */
describe("wake lock during a sit (pref + isActive)", () => {
  const renderSession = (isActive: boolean) =>
    renderHook((active: boolean) => {
      const pref = useKeepScreenAwakePref();
      useWakeLock(pref && active);
    }, isActive);

  it("acquires with no stored preference and releases when the sit ends (#730)", async () => {
    const wakeLock = installWakeLock();

    const view = await renderSession(false);
    expect(wakeLock.request).not.toHaveBeenCalled();

    await view.rerender(true);
    expect(wakeLock.request).toHaveBeenCalledTimes(1);
    expect(wakeLock.sentinels[0].released).toBe(false);

    await view.rerender(false);
    expect(wakeLock.sentinels[0].release).toHaveBeenCalledTimes(1);
    expect(wakeLock.sentinels[0].released).toBe(true);

    await view.unmount();
  });

  it("never acquires for a user who explicitly turned it off", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ keepScreenAwakeDuringSession: false }));
    const wakeLock = installWakeLock();

    const view = await renderSession(true);

    expect(wakeLock.request).not.toHaveBeenCalled();
    await view.unmount();
  });
});
