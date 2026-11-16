import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readSystemPrefersDark,
  subscribeSystemPrefersDark,
  subscribeThemeSync,
} from "@/lib/themeSync";
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

afterEach(() => vi.unstubAllGlobals());

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

  it("re-reads the stored preference when localStorage.clear() fires (key null)", () => {
    const store = new Map<string, string>([[THEME_STORAGE_KEY, "dark"]]);
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null } });
    const { win, listeners } = fakeWindow();
    const { root, attrs } = fakeRoot();
    subscribeThemeSync(win, root);
    expect(attrs.get("data-theme")).toBe("dark");

    // Another tab clears storage: key null, newValue null, and nothing is stored now.
    store.clear();
    for (const l of listeners) l(storageEvent(null, null));
    expect(attrs.has("data-theme")).toBe(false);
  });

  it("applies a value stored again after a clear", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null } });
    const { win, listeners } = fakeWindow();
    const { root, attrs } = fakeRoot();
    subscribeThemeSync(win, root);
    store.set(THEME_STORAGE_KEY, "light");
    for (const l of listeners) l(storageEvent(null, null));
    expect(attrs.get("data-theme")).toBe("light");
  });
});

describe("system colour scheme helpers", () => {
  it("reports dark only when the OS query matches", () => {
    expect(readSystemPrefersDark({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(readSystemPrefersDark({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("is false with no window or no matchMedia (SSR and old browsers)", () => {
    expect(readSystemPrefersDark(undefined)).toBe(false);
    expect(readSystemPrefersDark({})).toBe(false);
  });

  it("subscribes to OS changes and unsubscribes cleanly", () => {
    const handlers = new Set<() => void>();
    const win = {
      matchMedia: () => ({
        matches: false,
        addEventListener: (_t: "change", l: () => void) => handlers.add(l),
        removeEventListener: (_t: "change", l: () => void) => handlers.delete(l),
      }),
    };
    let calls = 0;
    const unsubscribe = subscribeSystemPrefersDark(win, () => calls++);
    for (const h of handlers) h();
    expect(calls).toBe(1);
    unsubscribe();
    expect(handlers.size).toBe(0);
  });
});
