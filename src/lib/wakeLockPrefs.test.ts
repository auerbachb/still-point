import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isWakeLockSupported,
  loadWakeLockPrefs,
  saveWakeLockPrefs,
  subscribeWakeLockPrefs,
} from "./wakeLockPrefs";

const STORAGE_KEY = "stillpoint_wake_lock_prefs";

function stubBrowserStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
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

describe("loadWakeLockPrefs", () => {
  it("returns opt-out default without window (SSR guard)", () => {
    expect(loadWakeLockPrefs()).toEqual({ keepScreenAwakeDuringSession: false });
  });

  it("returns default when nothing is stored", () => {
    stubBrowserStorage();
    expect(loadWakeLockPrefs()).toEqual({ keepScreenAwakeDuringSession: false });
  });

  it("reads a stored opt-in", () => {
    stubBrowserStorage({
      [STORAGE_KEY]: JSON.stringify({ keepScreenAwakeDuringSession: true }),
    });
    expect(loadWakeLockPrefs()).toEqual({ keepScreenAwakeDuringSession: true });
  });

  it("falls back to defaults on corrupt JSON", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "{not json" });
    expect(loadWakeLockPrefs()).toEqual({ keepScreenAwakeDuringSession: false });
  });

  it.each([
    ["non-object JSON", JSON.stringify("true")],
    ["null", JSON.stringify(null)],
    ["string instead of boolean", JSON.stringify({ keepScreenAwakeDuringSession: "true" })],
    ["number instead of boolean", JSON.stringify({ keepScreenAwakeDuringSession: 1 })],
    ["missing field", JSON.stringify({ other: true })],
  ])("falls back to defaults for %s", (_label, raw) => {
    stubBrowserStorage({ [STORAGE_KEY]: raw });
    expect(loadWakeLockPrefs()).toEqual({ keepScreenAwakeDuringSession: false });
  });
});

describe("saveWakeLockPrefs", () => {
  it("is a no-op without window (SSR guard)", () => {
    expect(() =>
      saveWakeLockPrefs({ keepScreenAwakeDuringSession: true }),
    ).not.toThrow();
  });

  it("round-trips through storage", () => {
    const store = stubBrowserStorage();
    saveWakeLockPrefs({ keepScreenAwakeDuringSession: true });
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toEqual({
      keepScreenAwakeDuringSession: true,
    });
    expect(loadWakeLockPrefs()).toEqual({ keepScreenAwakeDuringSession: true });
  });
});

describe("subscribeWakeLockPrefs", () => {
  it("notifies subscribers on save and stops after unsubscribe", () => {
    stubBrowserStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeWakeLockPrefs(listener);

    saveWakeLockPrefs({ keepScreenAwakeDuringSession: true });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveWakeLockPrefs({ keepScreenAwakeDuringSession: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("registers a cross-tab storage listener while subscribed", () => {
    stubBrowserStorage();
    const win = window as unknown as {
      addEventListener: ReturnType<typeof vi.fn>;
      removeEventListener: ReturnType<typeof vi.fn>;
    };
    const unsubscribe = subscribeWakeLockPrefs(() => {});
    expect(win.addEventListener).toHaveBeenCalledWith("storage", expect.any(Function));
    unsubscribe();
    expect(win.removeEventListener).toHaveBeenCalledWith("storage", expect.any(Function));
  });
});

describe("isWakeLockSupported", () => {
  it("is false without navigator (SSR guard)", () => {
    expect(isWakeLockSupported()).toBe(false);
  });

  it("is false when navigator lacks wakeLock", () => {
    vi.stubGlobal("navigator", {});
    expect(isWakeLockSupported()).toBe(false);
  });

  it("is true when navigator.wakeLock exists", () => {
    vi.stubGlobal("navigator", { wakeLock: { request: () => {} } });
    expect(isWakeLockSupported()).toBe(true);
  });
});
