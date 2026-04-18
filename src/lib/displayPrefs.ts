export type DisplayPrefs = {
  showTimer: boolean;
};

const STORAGE_KEY = "stillpoint_display_prefs";

const DEFAULTS: DisplayPrefs = {
  showTimer: true,
};

export function loadDisplayPrefs(): DisplayPrefs {
  if (typeof window === "undefined") return DEFAULTS;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
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
