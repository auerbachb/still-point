import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasRejectedSubmittedThoughts,
  normalizeThoughtInputs,
} from "./thoughtSaving";

describe("normalizeThoughtInputs", () => {
  it("accepts web completion note payloads", () => {
    const result = normalizeThoughtInputs([{ timeInSession: -1, text: "  final note  " }]);

    assert.equal(result.submittedCount, 1);
    assert.equal(result.invalidCount, 0);
    assert.deepEqual(result.thoughts, [{ timeInSession: -1, text: "final note" }]);
    assert.equal(hasRejectedSubmittedThoughts(result), false);
  });

  it("accepts iOS buddy embedded note payloads", () => {
    const result = normalizeThoughtInputs([
      { timeInSession: 12, text: "one" },
      { timeInSession: 58, text: "two" },
    ]);

    assert.equal(result.submittedCount, 2);
    assert.equal(result.invalidCount, 0);
    assert.deepEqual(result.thoughts, [
      { timeInSession: 12, text: "one" },
      { timeInSession: 58, text: "two" },
    ]);
    assert.equal(hasRejectedSubmittedThoughts(result), false);
  });

  it("flags submitted payloads that would otherwise save zero notes", () => {
    const result = normalizeThoughtInputs([{ timeInSession: "12", text: "lost" }]);

    assert.equal(result.submittedCount, 1);
    assert.equal(result.invalidCount, 1);
    assert.deepEqual(result.thoughts, []);
    assert.equal(hasRejectedSubmittedThoughts(result), true);
  });
});
