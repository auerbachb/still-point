"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  applyThemeAttribute,
  loadThemePreference,
  parseThemePreference,
  resolveTheme,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";
import { readSystemPrefersDark, subscribeSystemPrefersDark } from "@/lib/themeSync";

// Module-scope so useSyncExternalStore keeps one stable subscription.
const subscribeSystem = (onChange: () => void) => subscribeSystemPrefersDark(window, onChange);
const readSystem = () => readSystemPrefersDark(window);
const serverSystem = () => false;

/**
 * The user's theme choice, plus the theme actually on screen. Sets `data-theme`
 * on <html> when the choice changes, persists it, and follows another tab's
 * change. System tracks `prefers-color-scheme` live; CSS does the painting, so
 * the hook only needs the media query to report the resolved value.
 */
export function useThemePreference(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
} {
  // Seeded to the default so server and first client render match. The inline
  // script in the root layout has already set the real attribute by then.
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  // useSyncExternalStore: the server snapshot is `false` so hydration matches, and the
  // client then reads the real OS value before paint, with no flash of "light".
  const systemPrefersDark = useSyncExternalStore(subscribeSystem, readSystem, serverSystem);

  useEffect(() => {
    const stored = loadThemePreference();
    setPreferenceState(stored);
    applyThemeAttribute(document.documentElement, stored);

    const onStorage = (event: StorageEvent) => {
      // key === null is localStorage.clear(): re-read the stored value.
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      const next = event.key === null ? loadThemePreference() : parseThemePreference(event.newValue);
      setPreferenceState(next);
      applyThemeAttribute(document.documentElement, next);
    };
    window.addEventListener("storage", onStorage);

    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyThemeAttribute(document.documentElement, next);
    saveThemePreference(next);
  }, []);

  return {
    preference,
    resolved: resolveTheme(preference, systemPrefersDark),
    setPreference,
  };
}
