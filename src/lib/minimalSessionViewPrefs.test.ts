/**
 * Issue #669 — "just the timer" minimal session view.
 *
 * Covers the persisted preference that makes the choice survive into the next
 * sit, plus the listener contract `useSyncExternalStore` relies on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IOS_MINIMAL_SESSION_VIEW_KEY,
  MINIMAL_SESSION_VIEW_DEFAULT,
  MINIMAL_SESSION_VIEW_STORAGE_KEY,
  loadMinimalSessionViewPref,
  resetMinimalSessionViewPrefFallback,
  saveMinimalSessionViewPref,
  subscribeMinimalSessionViewPref,
} from "./minimalSessionViewPrefs";

type StorageOverrides = {
  setItem?: (key: string, value: string) => void;
  getItem?: (key: string) => string | null;
};

function stubBrowserStorage(
  initial: Record<string, string> = {},
  overrides: StorageOverrides = {},
) {
  const store = new Map(Object.entries(initial));
  const localStorageMock = {
    getItem: overrides.getItem ?? ((key: string) => store.get(key) ?? null),
    setItem:
      overrides.setItem
      ?? ((key: string, value: string) => {
        store.set(key, value);
      }),
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", {
    localStorage: localStorageMock,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("localStorage", localStorageMock);
  return store;
}

afterEach(() => {
  // Each case swaps in a fresh storage stub, so the fallback recorded by a
  // refused write must not leak into the next one.
  resetMinimalSessionViewPrefFallback();
  vi.unstubAllGlobals();
});

describe("minimal session view storage keys", () => {
  it("keeps the web and iOS keys aligned with the documented names", () => {
    expect(MINIMAL_SESSION_VIEW_STORAGE_KEY).toBe("stillpoint_minimal_session_view");
    expect(IOS_MINIMAL_SESSION_VIEW_KEY).toBe("sp_minimalSessionView");
  });
});

describe("loadMinimalSessionViewPref", () => {
  it("defaults to the full session screen", () => {
    expect(MINIMAL_SESSION_VIEW_DEFAULT).toBe(false);
    stubBrowserStorage();
    expect(loadMinimalSessionViewPref()).toBe(false);
  });

  it("returns the default outside the browser", () => {
    expect(loadMinimalSessionViewPref()).toBe(MINIMAL_SESSION_VIEW_DEFAULT);
  });

  it("reads both boolean encodings", () => {
    stubBrowserStorage({ [MINIMAL_SESSION_VIEW_STORAGE_KEY]: "true" });
    expect(loadMinimalSessionViewPref()).toBe(true);

    stubBrowserStorage({ [MINIMAL_SESSION_VIEW_STORAGE_KEY]: "1" });
    expect(loadMinimalSessionViewPref()).toBe(true);

    stubBrowserStorage({ [MINIMAL_SESSION_VIEW_STORAGE_KEY]: "false" });
    expect(loadMinimalSessionViewPref()).toBe(false);

    stubBrowserStorage({ [MINIMAL_SESSION_VIEW_STORAGE_KEY]: "0" });
    expect(loadMinimalSessionViewPref()).toBe(false);
  });

  it("falls back to the default for unparseable values", () => {
    stubBrowserStorage({ [MINIMAL_SESSION_VIEW_STORAGE_KEY]: "{not-a-bool}" });
    expect(loadMinimalSessionViewPref()).toBe(MINIMAL_SESSION_VIEW_DEFAULT);
  });

  it("falls back to the default when reading throws", () => {
    stubBrowserStorage(
      {},
      {
        getItem: () => {
          throw new Error("storage unavailable");
        },
      },
    );
    expect(loadMinimalSessionViewPref()).toBe(MINIMAL_SESSION_VIEW_DEFAULT);
  });
});

describe("saveMinimalSessionViewPref", () => {
  it("round-trips the choice so the next sit restores it", () => {
    const store = stubBrowserStorage();

    saveMinimalSessionViewPref(true);
    expect(store.get(MINIMAL_SESSION_VIEW_STORAGE_KEY)).toBe("true");
    expect(loadMinimalSessionViewPref()).toBe(true);

    // Easy to reverse: toggling back clears the minimal view for the next sit.
    saveMinimalSessionViewPref(false);
    expect(store.get(MINIMAL_SESSION_VIEW_STORAGE_KEY)).toBe("false");
    expect(loadMinimalSessionViewPref()).toBe(false);
  });

  it("is a no-op outside the browser", () => {
    expect(() => saveMinimalSessionViewPref(true)).not.toThrow();
  });

  it("still notifies subscribers when the write fails", () => {
    stubBrowserStorage(
      {},
      {
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    );
    const listener = vi.fn();
    const unsubscribe = subscribeMinimalSessionViewPref(listener);

    expect(() => saveMinimalSessionViewPref(true)).not.toThrow();
    // The live sit must still toggle even when persistence is unavailable.
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("keeps the choice readable after a refused write, so the live sit still toggles", () => {
    stubBrowserStorage(
      {},
      {
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    );

    saveMinimalSessionViewPref(true);
    // Notifying listeners is not enough — the hook re-reads through the loader,
    // which would otherwise still report the (unwritten) stored value.
    expect(loadMinimalSessionViewPref()).toBe(true);

    saveMinimalSessionViewPref(false);
    expect(loadMinimalSessionViewPref()).toBe(false);
  });

  it("hands authority back to storage once a write lands", () => {
    // Storage that refuses writes until `refuse` is cleared, so one test can walk
    // the private-browsing path and then the recovery.
    const backing = new Map<string, string>();
    let refuse = true;
    stubBrowserStorage(
      {},
      {
        setItem: (key, value) => {
          if (refuse) throw new Error("quota exceeded");
          backing.set(key, value);
        },
        getItem: key => backing.get(key) ?? null,
      },
    );

    saveMinimalSessionViewPref(true);
    expect(loadMinimalSessionViewPref()).toBe(true);

    refuse = false;
    saveMinimalSessionViewPref(false);
    expect(backing.get(MINIMAL_SESSION_VIEW_STORAGE_KEY)).toBe("false");
    expect(loadMinimalSessionViewPref()).toBe(false);

    // Storage is authoritative again: a value written behind our back is read back.
    backing.set(MINIMAL_SESSION_VIEW_STORAGE_KEY, "true");
    expect(loadMinimalSessionViewPref()).toBe(true);
  });

  it("lets a cross-tab write take authority back from a refused write", () => {
    stubBrowserStorage(
      { [MINIMAL_SESSION_VIEW_STORAGE_KEY]: "false" },
      {
        setItem: () => {
          throw new Error("quota exceeded");
        },
      },
    );
    const addEventListener = window.addEventListener as unknown as ReturnType<typeof vi.fn>;
    const unsubscribe = subscribeMinimalSessionViewPref(vi.fn());
    const onStorage = addEventListener.mock.calls[0][1] as (e: StorageEvent) => void;

    saveMinimalSessionViewPref(true);
    expect(loadMinimalSessionViewPref()).toBe(true);

    onStorage({ key: MINIMAL_SESSION_VIEW_STORAGE_KEY } as StorageEvent);
    expect(loadMinimalSessionViewPref()).toBe(false);

    unsubscribe();
  });
});

describe("subscribeMinimalSessionViewPref", () => {
  it("notifies same-tab listeners on every save and stops after unsubscribe", () => {
    stubBrowserStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeMinimalSessionViewPref(listener);

    saveMinimalSessionViewPref(true);
    saveMinimalSessionViewPref(false);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    saveMinimalSessionViewPref(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("registers a storage listener for the first subscriber only", () => {
    stubBrowserStorage();
    const addEventListener = window.addEventListener as unknown as ReturnType<typeof vi.fn>;

    const first = subscribeMinimalSessionViewPref(vi.fn());
    const second = subscribeMinimalSessionViewPref(vi.fn());
    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith("storage", expect.any(Function));

    first();
    second();
    const removeEventListener = window.removeEventListener as unknown as ReturnType<typeof vi.fn>;
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("fans out cross-tab storage events for this key and for a full clear", () => {
    stubBrowserStorage();
    const addEventListener = window.addEventListener as unknown as ReturnType<typeof vi.fn>;
    const listener = vi.fn();
    const unsubscribe = subscribeMinimalSessionViewPref(listener);

    const onStorage = addEventListener.mock.calls[0][1] as (e: StorageEvent) => void;

    onStorage({ key: MINIMAL_SESSION_VIEW_STORAGE_KEY } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(1);

    // key === null means the whole storage area was cleared.
    onStorage({ key: null } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(2);

    onStorage({ key: "stillpoint_unrelated_pref" } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("ignores storage events from a different storage area", () => {
    stubBrowserStorage();
    const addEventListener = window.addEventListener as unknown as ReturnType<typeof vi.fn>;
    const listener = vi.fn();
    const unsubscribe = subscribeMinimalSessionViewPref(listener);
    const onStorage = addEventListener.mock.calls[0][1] as (e: StorageEvent) => void;

    // `storage` fires for sessionStorage too — same key, different area.
    const sessionArea = { getItem: () => null } as unknown as Storage;
    onStorage({ key: MINIMAL_SESSION_VIEW_STORAGE_KEY, storageArea: sessionArea } as StorageEvent);
    onStorage({ key: null, storageArea: sessionArea } as StorageEvent);
    expect(listener).not.toHaveBeenCalled();

    onStorage({
      key: MINIMAL_SESSION_VIEW_STORAGE_KEY,
      storageArea: window.localStorage,
    } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
