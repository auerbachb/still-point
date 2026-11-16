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
    if (event.key !== THEME_STORAGE_KEY) return;
    applyThemeAttribute(root, parseThemePreference(event.newValue));
  };
  win.addEventListener("storage", onStorage);
  return () => win.removeEventListener("storage", onStorage);
}
