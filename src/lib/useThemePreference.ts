"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    const stored = loadThemePreference();
    setPreferenceState(stored);
    applyThemeAttribute(document.documentElement, stored);

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemPrefersDark(Boolean(media?.matches));
    syncSystem();
    media?.addEventListener?.("change", syncSystem);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = parseThemePreference(event.newValue);
      setPreferenceState(next);
      applyThemeAttribute(document.documentElement, next);
    };
    window.addEventListener("storage", onStorage);

    return () => {
      media?.removeEventListener?.("change", syncSystem);
      window.removeEventListener("storage", onStorage);
    };
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
