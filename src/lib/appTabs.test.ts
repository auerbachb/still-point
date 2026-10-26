import { describe, expect, test } from "vitest";
import { ALL_TABS, DEFAULT_TAB, isTab, NAV_TABS, pathForTab, TAB_LABELS } from "./appTabs";

describe("isTab", () => {
  test("accepts every route slug", () => {
    for (const tab of ALL_TABS) {
      expect(isTab(tab)).toBe(true);
    }
  });

  test("rejects a missing, empty, unknown, or differently-cased slug", () => {
    expect(isTab(undefined)).toBe(false);
    expect(isTab("")).toBe(false);
    expect(isTab("garbage")).toBe(false);
    expect(isTab("Progress")).toBe(false);
    // The nav label is not a route: the Progress tab lives at /app/progress.
    expect(isTab("home")).toBe(false);
  });
});

describe("pathForTab", () => {
  test("routes each tab to its /app segment", () => {
    expect(pathForTab("progress")).toBe("/app/progress");
    expect(pathForTab("buddy")).toBe("/app/buddy");
    for (const tab of ALL_TABS) {
      expect(pathForTab(tab)).toBe(`/app/${tab}`);
    }
  });
});

describe("tab vocabulary", () => {
  test("the nav lists every tab but buddy, Progress first", () => {
    expect(NAV_TABS).toEqual(["progress", "history", "journal", "board", "friends", "settings"]);
    expect(ALL_TABS).toEqual([...NAV_TABS, "buddy"]);
    expect(DEFAULT_TAB).toBe("progress");
  });

  test("the Progress tab keeps its shorter 'home' label", () => {
    expect(TAB_LABELS.progress).toBe("home");
    for (const tab of ALL_TABS.filter((t) => t !== "progress")) {
      expect(TAB_LABELS[tab]).toBe(tab);
    }
  });
});
