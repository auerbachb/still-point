// Light / Dark / System theme preference (#29).
//
// The palette lives in src/app/globals.css: `:root` is dark, `:root[data-theme="light"]`
// is light, and a `prefers-color-scheme: light` media block covers System. So the
// attribute only has to exist for an explicit choice: System removes it, and CSS
// follows the OS live. This module is the pure resolve/persist logic; the React
// hook lives in useThemePreference.ts.

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";

/** New users, and anyone whose stored value is missing or unrecognised. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const THEME_STORAGE_KEY = "stillpoint_theme";

/** Attribute on <html> that CSS scopes the light palette to. */
export const THEME_ATTRIBUTE = "data-theme";

export const THEME_LABELS: Record<ThemePreference, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Parses a stored value; anything unrecognised falls back to System. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
}

/** The theme that is actually painted. System follows the OS preference. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return systemPrefersDark ? "dark" : "light";
}

/**
 * The `data-theme` value for a preference. `null` means remove the attribute,
 * which is how System hands the decision to the CSS media query.
 */
export function themeAttributeValue(preference: ThemePreference): ResolvedTheme | null {
  return preference === "system" ? null : preference;
}

/** Writes or removes `data-theme` on the given element for a preference. */
export function applyThemeAttribute(
  element: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void },
  preference: ThemePreference,
): void {
  const value = themeAttributeValue(preference);
  if (value === null) {
    element.removeAttribute(THEME_ATTRIBUTE);
  } else {
    element.setAttribute(THEME_ATTRIBUTE, value);
  }
}

/** Reads the stored preference. Storage can throw (private mode, blocked site data). */
export function loadThemePreference(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME_PREFERENCE;
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/** Persists the preference. Best-effort: a failed write just means the choice is not remembered. */
export function saveThemePreference(preference: ThemePreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage write failures.
  }
}

/**
 * Script the root layout inlines so the saved theme is on <html> before first
 * paint. The app has no CSP header or nonce setup, so an inline script is fine.
 * Built from the same key as loadThemePreference; theme.test.ts runs it against
 * a fake document to keep the two in step.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var r=document.documentElement;if(p==="light"||p==="dark"){r.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},p)}else{r.removeAttribute(${JSON.stringify(THEME_ATTRIBUTE)})}}catch(e){}})();`;
