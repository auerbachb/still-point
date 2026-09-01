import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSuppressDuringSessionPref,
  loadSuppressDuringSessionPref,
  saveSuppressDuringSessionPref,
  subscribeSuppressDuringSessionPref,
  suppressDuringSessionPrefVersion,
  SUPPRESS_DURING_SESSION_DEFAULT,
} from "./sessionSuppressionPrefs";

const STORAGE_KEY = "stillpoint_suppress_during_session";

function stubBrowserStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
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
  vi.unstubAllGlobals();
});

describe("loadSuppressDuringSessionPref", () => {
  it("defaults to silencing when nothing is stored (#709)", () => {
    stubBrowserStorage();
    expect(loadSuppressDuringSessionPref()).toBe(true);
    expect(SUPPRESS_DURING_SESSION_DEFAULT).toBe(true);
  });

  it("honors a stored opt-out", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "false" });
    expect(loadSuppressDuringSessionPref()).toBe(false);
  });
});

describe("clearSuppressDuringSessionPref (auth boundary, #709)", () => {
  it("drops one account's opt-out so the next account starts silent", () => {
    const store = stubBrowserStorage({ [STORAGE_KEY]: "false" });
    // Signed-out user had turned "During sessions" off.
    expect(loadSuppressDuringSessionPref()).toBe(false);

    clearSuppressDuringSessionPref();

    // The key is gone entirely, so the read falls back to the silent default
    // rather than inheriting the previous account's choice. Without this, the
    // next account never reports its sit and takes banners mid-sit.
    expect(store.has(STORAGE_KEY)).toBe(false);
    expect(loadSuppressDuringSessionPref()).toBe(true);
  });

  it("notifies subscribers so an open session view re-reads immediately", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "false" });
    const listener = vi.fn();
    const unsubscribe = subscribeSuppressDuringSessionPref(listener);

    clearSuppressDuringSessionPref();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("is a no-op without window (SSR guard)", () => {
    expect(() => clearSuppressDuringSessionPref()).not.toThrow();
  });

  it("leaves the silent default in force when storage removal throws", () => {
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error("storage disabled");
      },
    };
    vi.stubGlobal("window", {
      localStorage: throwingStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("localStorage", throwingStorage);

    expect(() => clearSuppressDuringSessionPref()).not.toThrow();
    expect(loadSuppressDuringSessionPref()).toBe(true);
  });
});

describe("saveSuppressDuringSessionPref", () => {
  it("round-trips both values through storage", () => {
    stubBrowserStorage();
    saveSuppressDuringSessionPref(false);
    expect(loadSuppressDuringSessionPref()).toBe(false);
    saveSuppressDuringSessionPref(true);
    expect(loadSuppressDuringSessionPref()).toBe(true);
  });
});

describe("suppressDuringSessionPrefVersion (sit-start fetch race, #709)", () => {
  it("advances on every mirror write so a stale response can be detected", () => {
    stubBrowserStorage();

    // A sit starts and samples the version before fetching the server row.
    const versionAtRequest = suppressDuringSessionPrefVersion();

    // The user toggles "During sessions" off while that fetch is on the wire.
    saveSuppressDuringSessionPref(false);

    // The response — carrying the pre-toggle `true` — must now be discarded.
    expect(suppressDuringSessionPrefVersion()).not.toBe(versionAtRequest);
    expect(loadSuppressDuringSessionPref()).toBe(false);
  });

  it("advances on an auth-boundary clear, which reads back as the default", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "true" });

    const versionAtRequest = suppressDuringSessionPrefVersion();
    clearSuppressDuringSessionPref();

    // The stored value round-trips to the same boolean, so only the version
    // separates "unchanged" from "cleared by a sign-out".
    expect(loadSuppressDuringSessionPref()).toBe(SUPPRESS_DURING_SESSION_DEFAULT);
    expect(suppressDuringSessionPrefVersion()).not.toBe(versionAtRequest);
  });

  it("holds steady across reads when nothing writes", () => {
    stubBrowserStorage();

    const versionAtRequest = suppressDuringSessionPrefVersion();
    loadSuppressDuringSessionPref();
    loadSuppressDuringSessionPref();

    // The uncontended path must still let the sit-start fetch backfill the
    // mirror — that is what corrects an opted-out user on a fresh browser.
    expect(suppressDuringSessionPrefVersion()).toBe(versionAtRequest);
  });
});
