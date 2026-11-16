// App-wide theme sync (#29). Mounted from the root layout so every screen keeps
// `data-theme` in step with the stored choice, not only the Settings screen.
// System needs no JS: the prefers-color-scheme block in globals.css repaints live.

import {
  applyThemeAttribute,
  loadThemePreference,
  parseThemePreference,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/**
 * Applies the stored choice now and follows another tab's change for as long as
 * the returned unsubscribe is not called.
 */
export function subscribeThemeSync(
  win: {
    addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
    removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  },
  root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
): () => void {
  applyThemeAttribute(root, loadThemePreference());

  const onStorage = (event: StorageEvent) => {
    // key === null means localStorage.clear(): re-read rather than trust newValue.
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = event.key === null ? loadThemePreference() : parseThemePreference(event.newValue);
    applyThemeAttribute(root, next);
  };
  win.addEventListener("storage", onStorage);
  return () => win.removeEventListener("storage", onStorage);
}

/** Whether the OS currently prefers dark. False when there is no window or no matchMedia. */
export function readSystemPrefersDark(win: { matchMedia?: (query: string) => { matches: boolean } } | undefined): boolean {
  return Boolean(win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
}

/**
 * Calls onChange when the OS colour scheme changes. Returns the unsubscribe.
 * Used with useSyncExternalStore so the server snapshot stays `false` and the
 * client reads the real value without a hydration mismatch.
 */
export function subscribeSystemPrefersDark(
  win: { matchMedia?: (query: string) => MediaQueryListLike },
  onChange: () => void,
): () => void {
  const media = win.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}

interface MediaQueryListLike {
  matches: boolean;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}
