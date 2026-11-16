import { describe, expect, it } from "vitest";
import { subscribeThemeSync } from "@/lib/themeSync";
import { THEME_STORAGE_KEY } from "@/lib/theme";

function fakeWindow() {
  const listeners = new Set<(event: StorageEvent) => void>();
  return {
    listeners,
    win: {
      addEventListener: (_t: "storage", l: (event: StorageEvent) => void) => listeners.add(l),
      removeEventListener: (_t: "storage", l: (event: StorageEvent) => void) => listeners.delete(l),
    },
  };
}

function fakeRoot() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    root: {
      setAttribute: (n: string, v: string) => attrs.set(n, v),
      removeAttribute: (n: string) => attrs.delete(n),
    },
  };
}

function storageEvent(key: string | null, newValue: string | null) {
  return { key, newValue } as StorageEvent;
}

describe("subscribeThemeSync", () => {
  it("applies the default (System, attribute removed) when nothing can be read", () => {
    // The node test environment has no window, so loadThemePreference returns the default.
    const { win } = fakeWindow();
    const { root, attrs } = fakeRoot();
    attrs.set("data-theme", "dark");
    subscribeThemeSync(win, root);
    expect(attrs.has("data-theme")).toBe(false);
  });

  it("follows another tab's change on any screen, without Settings mounted", () => {
    const { win, listeners } = fakeWindow();
    const { root, attrs } = fakeRoot();
    subscribeThemeSync(win, root);
    for (const l of listeners) l(storageEvent(THEME_STORAGE_KEY, "light"));
    expect(attrs.get("data-theme")).toBe("light");
    for (const l of listeners) l(storageEvent(THEME_STORAGE_KEY, "system"));
    expect(attrs.has("data-theme")).toBe(false);
  });

  it("ignores storage events for other keys", () => {
    const { win, listeners } = fakeWindow();
    const { root, attrs } = fakeRoot();
    subscribeThemeSync(win, root);
    for (const l of listeners) l(storageEvent("something_else", "light"));
    expect(attrs.has("data-theme")).toBe(false);
  });

  it("unsubscribe removes the listener", () => {
    const { win, listeners } = fakeWindow();
    const { root } = fakeRoot();
    const unsubscribe = subscribeThemeSync(win, root);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
