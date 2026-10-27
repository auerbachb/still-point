/**
 * Issue #837 (focus activity tracking 3/5, #765): the focus categories, their
 * guards, the picker's content table, and History's label for a focus row.
 */
import { describe, expect, test } from "vitest";
import { FOCUS_CATEGORIES, isFocusCategory, parseOptionalFocusCategory } from "./constants";
import { FOCUS_ACTIVITIES, focusActivityById, focusSessionLabel } from "./focusActivityContent";

/** Values that are present but are not a category. */
const NOT_CATEGORIES: unknown[] = [
  "Reading",
  "WRITING",
  " listening",
  "listening ",
  "",
  "focus",
  "music",
  0,
  1,
  true,
  false,
  {},
  { id: "reading" },
  ["reading"],
  Number.NaN,
];

describe("FOCUS_CATEGORIES (#837)", () => {
  test("are reading, writing and listening, in that order", () => {
    expect(FOCUS_CATEGORIES).toEqual(["reading", "writing", "listening"]);
  });
});

describe("isFocusCategory (#837)", () => {
  test("accepts the three ids", () => {
    for (const category of FOCUS_CATEGORIES) {
      expect(isFocusCategory(category)).toBe(true);
    }
  });

  test("rejects everything else, null and absent included", () => {
    for (const value of [...NOT_CATEGORIES, null, undefined]) {
      expect(isFocusCategory(value)).toBe(false);
    }
  });
});

describe("parseOptionalFocusCategory (#837)", () => {
  test("returns each id as itself", () => {
    for (const category of FOCUS_CATEGORIES) {
      expect(parseOptionalFocusCategory(category)).toBe(category);
    }
  });

  test("absent and null are no category", () => {
    expect(parseOptionalFocusCategory(undefined)).toBeNull();
    expect(parseOptionalFocusCategory(null)).toBeNull();
  });

  test("wrong case, the empty string, numbers and objects are invalid", () => {
    for (const value of NOT_CATEGORIES) {
      expect(parseOptionalFocusCategory(value)).toBeUndefined();
    }
  });
});

describe("focusActivityContent (#837)", () => {
  test("has one entry per category, in FOCUS_CATEGORIES order", () => {
    expect(FOCUS_ACTIVITIES.map(activity => activity.id)).toEqual([...FOCUS_CATEGORIES]);
  });

  test("every entry has a label and a short description", () => {
    for (const activity of FOCUS_ACTIVITIES) {
      expect(activity.label.trim()).not.toBe("");
      expect(activity.description.trim()).not.toBe("");
      expect(activity.description.length).toBeLessThanOrEqual(80);
    }
  });

  test("focusActivityById finds each category", () => {
    expect(focusActivityById("reading").label).toBe("Reading");
    expect(focusActivityById("writing").label).toBe("Writing");
    expect(focusActivityById("listening").label).toBe("Listening");
  });

  test("focusActivityById throws on an unknown id, as guidedExerciseById does", () => {
    expect(() => focusActivityById("music" as never)).toThrow("Unknown focus activity: music");
  });
});

describe("focusSessionLabel — History's focus row (#837)", () => {
  test("names the category when the session has one", () => {
    expect(focusSessionLabel("reading")).toBe("Focus · Reading");
    expect(focusSessionLabel("writing")).toBe("Focus · Writing");
    expect(focusSessionLabel("listening")).toBe("Focus · Listening");
  });

  test("a session saved before categories still reads Focus", () => {
    expect(focusSessionLabel(null)).toBe("Focus");
    expect(focusSessionLabel(undefined)).toBe("Focus");
  });

  test("a category this client does not know reads Focus rather than failing", () => {
    expect(focusSessionLabel("music")).toBe("Focus");
    expect(focusSessionLabel("Reading")).toBe("Focus");
    expect(focusSessionLabel("")).toBe("Focus");
  });
});
