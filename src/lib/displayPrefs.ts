export type DisplayPrefs = {
  showTimer: boolean;
  /** #662: animate the sit as sand moving between two piles instead of digits. Solo sits only. */
  sandAnimation: boolean;
  /**
   * #75: session-screen components the user can hide. The countdown and the
   * pause/end controls are never hideable. Hidden components are removed from
   * the layout, so the rest reflows. Minimal view (#669) overrides these.
   */
  showBlockGrid: boolean;
  showProgressBar: boolean;
  showMindStateBar: boolean;
};

const STORAGE_KEY = "stillpoint_display_prefs";

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  showTimer: true,
  sandAnimation: false,
  showBlockGrid: true,
  showProgressBar: true,
  showMindStateBar: true,
};

export function loadDisplayPrefs(): DisplayPrefs {
  if (typeof window === "undefined") return DEFAULT_DISPLAY_PREFS;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DISPLAY_PREFS;
    return { ...DEFAULT_DISPLAY_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_DISPLAY_PREFS;
  }
}

export function saveDisplayPrefs(prefs: DisplayPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort persistence: ignore storage write failures.
  }
}
