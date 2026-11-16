import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyThemeAttribute,
  isThemePreference,
  parseThemePreference,
  resolveTheme,
  themeAttributeValue,
} from "./theme";

type FakeElement = {
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

function fakeElement(initial: Record<string, string> = {}): FakeElement {
  return {
    attrs: { ...initial },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  };
}

/** Runs the inline layout script against a fake <html> and storage. */
function runInitScript(stored: string | null, storageThrows = false) {
  const root = fakeElement({ class: "keep-me" });
  const storage = {
    getItem(key: string) {
      if (storageThrows) throw new Error("blocked");
      return key === THEME_STORAGE_KEY ? stored : null;
    },
  };
  new Function("localStorage", "document", THEME_INIT_SCRIPT)(storage, { documentElement: root });
  return root.attrs;
}

describe("parseThemePreference", () => {
  it("accepts the three known values", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to System for missing or unknown values", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference("")).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference("LIGHT")).toBe("system");
  });

  it("defaults new users to System", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("system");
  });

  it("type guard rejects non-strings", () => {
    expect(isThemePreference(42)).toBe(false);
    expect(isThemePreference("dark")).toBe(true);
  });
});

describe("resolveTheme", () => {
  it("explicit choices ignore the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("System follows the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("themeAttributeValue", () => {
  it("System removes the attribute so CSS media queries decide", () => {
    expect(themeAttributeValue("system")).toBeNull();
  });

  it("explicit choices set the attribute to their own value", () => {
    expect(themeAttributeValue("light")).toBe("light");
    expect(themeAttributeValue("dark")).toBe("dark");
  });
});

describe("applyThemeAttribute", () => {
  it("sets data-theme for light and dark, and removes it for system", () => {
    const el = fakeElement();
    applyThemeAttribute(el, "light");
    expect(el.attrs["data-theme"]).toBe("light");
    applyThemeAttribute(el, "dark");
    expect(el.attrs["data-theme"]).toBe("dark");
    applyThemeAttribute(el, "system");
    expect(el.attrs).not.toHaveProperty("data-theme");
  });
});

describe("THEME_INIT_SCRIPT (before-paint script)", () => {
  it("applies a stored explicit light choice", () => {
    expect(runInitScript("light")).toEqual({ "data-theme": "light", class: "keep-me" });
  });

  it("applies a stored explicit dark choice", () => {
    expect(runInitScript("dark")).toEqual({ "data-theme": "dark", class: "keep-me" });
  });

  it("leaves the attribute absent for System", () => {
    expect(runInitScript("system")).toEqual({ class: "keep-me" });
  });

  it("leaves the attribute absent for a new user with nothing stored", () => {
    expect(runInitScript(null)).toEqual({ class: "keep-me" });
  });

  it("ignores a garbage stored value", () => {
    expect(runInitScript("<script>")).toEqual({ class: "keep-me" });
  });

  it("does not throw when storage is blocked", () => {
    expect(runInitScript("dark", true)).toEqual({ class: "keep-me" });
  });
});
