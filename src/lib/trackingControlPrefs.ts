/**
 * #186 / #188: distraction/hyperfocus hold-cluster visibility.
 * - #188 progressive unlock after one completed sit with planned duration >= 5 min
 * - #186 user preference to hide the cluster entirely (web localStorage + iOS UserDefaults)
 */

export type TrackingControlPrefs = {
  /** #186: hide distraction/hyperfocus hold buttons and keyboard-hint copy during sits. */
  hideDistractionHyperfocusControls: boolean;
  /** #188: true once the user has completed a qualifying 5+ minute sit. */
  trackingControlsUnlocked: boolean;
};

/** Planned sit length (seconds) required to unlock tracking controls (#188). */
export const TRACKING_UNLOCK_MIN_DURATION_SECONDS = 300;

const STORAGE_KEY = "stillpoint_tracking_control_prefs";

const DEFAULTS: TrackingControlPrefs = {
  hideDistractionHyperfocusControls: false,
  trackingControlsUnlocked: false,
};

/** iOS UserDefaults key (parity with web localStorage). */
export const IOS_HIDE_TRACKING_CONTROLS_KEY = "sp_hideDistractionHyperfocusControls";
export const IOS_TRACKING_UNLOCK_KEY = "sp_trackingControlsUnlocked";

export function sessionQualifiesForTrackingUnlock(session: {
  duration: number;
  completed: boolean;
}): boolean {
  return session.completed && session.duration >= TRACKING_UNLOCK_MIN_DURATION_SECONDS;
}

function parseStoredPrefs(raw: string | null): TrackingControlPrefs {
  if (!raw) return DEFAULTS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const record = parsed as Record<string, unknown>;
    return {
      hideDistractionHyperfocusControls:
        typeof record.hideDistractionHyperfocusControls === "boolean"
          ? record.hideDistractionHyperfocusControls
          : DEFAULTS.hideDistractionHyperfocusControls,
      trackingControlsUnlocked:
        typeof record.trackingControlsUnlocked === "boolean"
          ? record.trackingControlsUnlocked
          : DEFAULTS.trackingControlsUnlocked,
    };
  } catch {
    return DEFAULTS;
  }
}

export function loadTrackingControlPrefs(): TrackingControlPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    return parseStoredPrefs(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULTS;
  }
}

function saveTrackingControlPrefs(prefs: TrackingControlPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
  notifyTrackingControlPrefsListeners();
}

export function saveHideDistractionHyperfocusControls(hide: boolean): void {
  saveTrackingControlPrefs({
    ...loadTrackingControlPrefs(),
    hideDistractionHyperfocusControls: hide,
  });
}

export function markTrackingControlsUnlocked(): void {
  const current = loadTrackingControlPrefs();
  if (current.trackingControlsUnlocked) return;
  saveTrackingControlPrefs({ ...current, trackingControlsUnlocked: true });
}

/** Clear account-scoped unlock on logout so the next sign-in re-qualifies (#188). */
export function resetTrackingUnlockOnLogout(): void {
  const current = loadTrackingControlPrefs();
  if (!current.trackingControlsUnlocked) return;
  saveTrackingControlPrefs({ ...current, trackingControlsUnlocked: false });
}

/** Persist unlock when a just-finished sit qualifies (#188). */
export function markTrackingUnlockIfQualifying(session: {
  duration: number;
  completed: boolean;
}): void {
  if (sessionQualifiesForTrackingUnlock(session)) {
    markTrackingControlsUnlocked();
  }
}

/** Backfill unlock from stored session history (e.g. existing practitioners). */
export function syncTrackingUnlockFromSessions(
  sessions: Array<{ duration: number; completed: boolean }>,
): void {
  if (loadTrackingControlPrefs().trackingControlsUnlocked) return;
  if (sessions.some(sessionQualifiesForTrackingUnlock)) {
    markTrackingControlsUnlocked();
  }
}

type TrackingControlPrefsListener = () => void;

const listeners = new Set<TrackingControlPrefsListener>();

function onStorageEvent(e: StorageEvent): void {
  if (e.key === STORAGE_KEY || e.key === null) notifyTrackingControlPrefsListeners();
}

function notifyTrackingControlPrefsListeners(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeTrackingControlPrefs(listener: TrackingControlPrefsListener): () => void {
  if (typeof window !== "undefined" && listeners.size === 0) {
    window.addEventListener("storage", onStorageEvent);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener("storage", onStorageEvent);
    }
  };
}
