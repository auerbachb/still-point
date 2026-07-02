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

const STORAGE_KEY = "stillpoint_tracking_control_prefs";

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

  it("reads stored prefs", () => {
    stubBrowserStorage({
      [STORAGE_KEY]: JSON.stringify({
        hideDistractionHyperfocusControls: true,
        trackingControlsUnlocked: true,
      }),
    });
    expect(loadTrackingControlPrefs()).toEqual({
      hideDistractionHyperfocusControls: true,
      trackingControlsUnlocked: true,
    });
  });

  it("falls back to defaults on corrupt JSON", () => {
    stubBrowserStorage({ [STORAGE_KEY]: "{not json" });
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
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toEqual({
      hideDistractionHyperfocusControls: false,
      trackingControlsUnlocked: true,
    });

    markTrackingUnlockIfQualifying({ duration: 60, completed: true });
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toMatchObject({
      trackingControlsUnlocked: true,
    });
  });
});

describe("syncTrackingUnlockFromSessions", () => {
  it("backfills unlock from session history", () => {
    const store = stubBrowserStorage();
    syncTrackingUnlockFromSessions([
      { duration: 60, completed: true },
      { duration: 300, completed: true },
    ]);
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toMatchObject({
      trackingControlsUnlocked: true,
    });
  });

  it("is a no-op when already unlocked", () => {
    const store = stubBrowserStorage({
      [STORAGE_KEY]: JSON.stringify({
        hideDistractionHyperfocusControls: true,
        trackingControlsUnlocked: true,
      }),
    });
    syncTrackingUnlockFromSessions([{ duration: 60, completed: false }]);
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toEqual({
      hideDistractionHyperfocusControls: true,
      trackingControlsUnlocked: true,
    });
  });
});

describe("saveHideDistractionHyperfocusControls", () => {
  it("round-trips hide preference without clearing unlock", () => {
    const store = stubBrowserStorage();
    markTrackingControlsUnlocked();
    saveHideDistractionHyperfocusControls(true);
    expect(JSON.parse(store.get(STORAGE_KEY) ?? "")).toEqual({
      hideDistractionHyperfocusControls: true,
      trackingControlsUnlocked: true,
    });
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
