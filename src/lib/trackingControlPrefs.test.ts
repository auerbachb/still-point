import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TRACKING_UNLOCK_MIN_DURATION_SECONDS,
  loadTrackingControlPrefs,
  markTrackingControlsUnlocked,
  markTrackingUnlockIfQualifying,
  saveHideDistractionHyperfocusControls,
  sessionQualifiesForTrackingUnlock,
  subscribeTrackingControlPrefs,
  syncTrackingUnlockFromSessions,
} from "./trackingControlPrefs";

const LEGACY_STORAGE_KEY = "stillpoint_tracking_control_prefs";
const HIDE_STORAGE_KEY = "stillpoint_hide_distraction_hyperfocus_controls";
const UNLOCK_STORAGE_KEY = "stillpoint_tracking_controls_unlocked";

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

describe("sessionQualifiesForTrackingUnlock", () => {
  it("requires completed sits with planned duration >= 300 seconds", () => {
    expect(
      sessionQualifiesForTrackingUnlock({
        duration: TRACKING_UNLOCK_MIN_DURATION_SECONDS,
        completed: true,
      }),
    ).toBe(true);
    expect(
      sessionQualifiesForTrackingUnlock({
        duration: TRACKING_UNLOCK_MIN_DURATION_SECONDS - 1,
        completed: true,
      }),
    ).toBe(false);
    expect(
      sessionQualifiesForTrackingUnlock({
        duration: TRACKING_UNLOCK_MIN_DURATION_SECONDS,
        completed: false,
      }),
    ).toBe(false);
  });
});

describe("loadTrackingControlPrefs", () => {
  it("returns locked/hidden defaults without window (SSR guard)", () => {
    expect(loadTrackingControlPrefs()).toEqual({
      hideDistractionHyperfocusControls: false,
      trackingControlsUnlocked: false,
    });
  });

  it("reads stored prefs from per-field keys", () => {
    stubBrowserStorage({
      [HIDE_STORAGE_KEY]: "true",
      [UNLOCK_STORAGE_KEY]: "true",
    });
    expect(loadTrackingControlPrefs()).toEqual({
      hideDistractionHyperfocusControls: true,
      trackingControlsUnlocked: true,
    });
  });

  it("migrates legacy combined blob to per-field keys", () => {
    const store = stubBrowserStorage({
      [LEGACY_STORAGE_KEY]: JSON.stringify({
        hideDistractionHyperfocusControls: true,
        trackingControlsUnlocked: true,
      }),
    });
    expect(loadTrackingControlPrefs()).toEqual({
      hideDistractionHyperfocusControls: true,
      trackingControlsUnlocked: true,
    });
    expect(store.get(HIDE_STORAGE_KEY)).toBe("true");
    expect(store.get(UNLOCK_STORAGE_KEY)).toBe("true");
    expect(store.has(LEGACY_STORAGE_KEY)).toBe(false);
  });

  it("falls back to defaults on corrupt legacy JSON", () => {
    stubBrowserStorage({ [LEGACY_STORAGE_KEY]: "{not json" });
    expect(loadTrackingControlPrefs()).toEqual({
      hideDistractionHyperfocusControls: false,
      trackingControlsUnlocked: false,
    });
  });
});

describe("markTrackingUnlockIfQualifying", () => {
  it("persists unlock for qualifying sessions only", () => {
    const store = stubBrowserStorage();
    markTrackingUnlockIfQualifying({ duration: 300, completed: true });
    expect(store.get(UNLOCK_STORAGE_KEY)).toBe("true");
    expect(loadTrackingControlPrefs().hideDistractionHyperfocusControls).toBe(false);

    markTrackingUnlockIfQualifying({ duration: 60, completed: true });
    expect(store.get(UNLOCK_STORAGE_KEY)).toBe("true");
  });
});

describe("syncTrackingUnlockFromSessions", () => {
  it("backfills unlock from session history", () => {
    const store = stubBrowserStorage();
    syncTrackingUnlockFromSessions([
      { duration: 60, completed: true },
      { duration: 300, completed: true },
    ]);
    expect(store.get(UNLOCK_STORAGE_KEY)).toBe("true");
  });

  it("is a no-op when already unlocked", () => {
    const store = stubBrowserStorage({
      [HIDE_STORAGE_KEY]: "true",
      [UNLOCK_STORAGE_KEY]: "true",
    });
    syncTrackingUnlockFromSessions([{ duration: 60, completed: false }]);
    expect(store.get(HIDE_STORAGE_KEY)).toBe("true");
    expect(store.get(UNLOCK_STORAGE_KEY)).toBe("true");
  });
});

describe("saveHideDistractionHyperfocusControls", () => {
  it("round-trips hide preference without clearing unlock", () => {
    const store = stubBrowserStorage();
    markTrackingControlsUnlocked();
    saveHideDistractionHyperfocusControls(true);
    expect(store.get(HIDE_STORAGE_KEY)).toBe("true");
    expect(store.get(UNLOCK_STORAGE_KEY)).toBe("true");
  });
});

describe("subscribeTrackingControlPrefs", () => {
  it("notifies subscribers on save", () => {
    stubBrowserStorage();
    const listener = vi.fn();
    const unsubscribe = subscribeTrackingControlPrefs(listener);

    saveHideDistractionHyperfocusControls(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    markTrackingControlsUnlocked();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
