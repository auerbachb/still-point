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

/** Legacy combined blob — migrated to per-field keys on read. */
const LEGACY_STORAGE_KEY = "stillpoint_tracking_control_prefs";
const HIDE_STORAGE_KEY = "stillpoint_hide_distraction_hyperfocus_controls";
const UNLOCK_STORAGE_KEY = "stillpoint_tracking_controls_unlocked";

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

function parseLegacyPrefs(raw: string | null): TrackingControlPrefs {
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

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  localStorage.setItem(key, value ? "true" : "false");
}

function migrateLegacyPrefsIfNeeded(): void {
  const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyRaw) return;
  const legacy = parseLegacyPrefs(legacyRaw);
  writeBool(HIDE_STORAGE_KEY, legacy.hideDistractionHyperfocusControls);
  writeBool(UNLOCK_STORAGE_KEY, legacy.trackingControlsUnlocked);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function loadTrackingControlPrefs(): TrackingControlPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    migrateLegacyPrefsIfNeeded();
    return {
      hideDistractionHyperfocusControls: readBool(
        HIDE_STORAGE_KEY,
        DEFAULTS.hideDistractionHyperfocusControls,
      ),
      trackingControlsUnlocked: readBool(
        UNLOCK_STORAGE_KEY,
        DEFAULTS.trackingControlsUnlocked,
      ),
    };
  } catch {
    return DEFAULTS;
  }
}

function notifyPrefChange(): void {
  notifyTrackingControlPrefsListeners();
}

export function saveHideDistractionHyperfocusControls(hide: boolean): void {
  if (typeof window === "undefined") return;
  try {
    writeBool(HIDE_STORAGE_KEY, hide);
    notifyPrefChange();
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
}

export function markTrackingControlsUnlocked(): void {
  if (typeof window === "undefined") return;
  if (loadTrackingControlPrefs().trackingControlsUnlocked) return;
  try {
    writeBool(UNLOCK_STORAGE_KEY, true);
    notifyPrefChange();
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
}

/** Clear account-scoped unlock on logout so the next sign-in re-qualifies (#188). */
export function resetTrackingUnlockOnLogout(): void {
  if (typeof window === "undefined") return;
  if (!loadTrackingControlPrefs().trackingControlsUnlocked) return;
  try {
    writeBool(UNLOCK_STORAGE_KEY, false);
    notifyPrefChange();
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
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
  if (
    e.key === HIDE_STORAGE_KEY
    || e.key === UNLOCK_STORAGE_KEY
    || e.key === LEGACY_STORAGE_KEY
    || e.key === null
  ) {
    notifyTrackingControlPrefsListeners();
  }
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
