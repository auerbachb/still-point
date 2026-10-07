import { describe, expect, test } from "vitest";
import {
  COMPLETION_RETURN_LABEL,
  noteTextToAutosave,
  ratingsAutosavePayload,
} from "./completionAutosave";

describe("completion autosave", () => {
  test("uses the issue's return label", () => {
    expect(COMPLETION_RETURN_LABEL).toBe("save and return to home");
  });

  test("autosaves a trimmed note and skips blank text", () => {
    expect(noteTextToAutosave("  after the sit  ")).toBe("after the sit");
    expect(noteTextToAutosave("   ")).toBeNull();
    expect(noteTextToAutosave("")).toBeNull();
  });

  test("autosaves only ratings the user moved", () => {
    expect(ratingsAutosavePayload({
      focusRating: 5,
      happinessRating: 5,
      focusTouched: false,
      happinessTouched: false,
    })).toBeNull();

    expect(ratingsAutosavePayload({
      focusRating: 8,
      happinessRating: 5,
      focusTouched: true,
      happinessTouched: false,
    })).toEqual({ focusRating: 8 });

    expect(ratingsAutosavePayload({
      focusRating: 8,
      happinessRating: 3,
      focusTouched: true,
      happinessTouched: true,
    })).toEqual({ focusRating: 8, happinessRating: 3 });
  });
});
