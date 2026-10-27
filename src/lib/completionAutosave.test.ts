import { describe, expect, test } from "vitest";
import {
  COMPLETION_RETURN_LABEL,
  noteTextToAutosave,
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
});
