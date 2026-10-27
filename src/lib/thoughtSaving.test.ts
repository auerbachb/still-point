import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  hasRejectedSubmittedThoughts,
  normalizeThoughtInputs,
  parseClearCompletionNote,
} from "./thoughtSaving";

describe("normalizeThoughtInputs", () => {
  it("accepts empty payload arrays without rejecting them", () => {
    const result = normalizeThoughtInputs([]);

    assert.equal(result.submittedCount, 0);
    assert.equal(result.invalidCount, 0);
    assert.deepEqual(result.thoughts, []);
    assert.equal(hasRejectedSubmittedThoughts(result), false);
  });

  it("flags mixed valid and invalid submitted payloads", () => {
    const result = normalizeThoughtInputs([
      { timeInSession: 12, text: "kept if normalized alone" },
      { timeInSession: "13", text: "invalid" },
    ]);

    assert.equal(result.submittedCount, 2);
    assert.equal(result.invalidCount, 1);
    assert.deepEqual(result.thoughts, [
      { timeInSession: 12, text: "kept if normalized alone" },
    ]);
    assert.equal(hasRejectedSubmittedThoughts(result), true);
  });

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

  it("flags text that is empty after trimming", () => {
    const result = normalizeThoughtInputs([{ timeInSession: 1, text: "   " }]);

    assert.equal(result.submittedCount, 1);
    assert.equal(result.invalidCount, 1);
    assert.deepEqual(result.thoughts, []);
    assert.equal(hasRejectedSubmittedThoughts(result), true);
  });

  it("accepts zero and negative in-session timestamps", () => {
    const result = normalizeThoughtInputs([
      { timeInSession: 0, text: "start" },
      { timeInSession: -2, text: "before completion sentinel" },
    ]);

    assert.equal(result.submittedCount, 2);
    assert.equal(result.invalidCount, 0);
    assert.deepEqual(result.thoughts, [
      { timeInSession: 0, text: "start" },
      { timeInSession: -2, text: "before completion sentinel" },
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

describe("normalizeThoughtInputs clientThoughtId (#948)", () => {
  const id = "9480a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b";

  it("keeps a thought's id, lowercased", () => {
    const result = normalizeThoughtInputs([
      { timeInSession: 12, text: "one", clientThoughtId: id },
      { timeInSession: 58, text: "two", clientThoughtId: id.toUpperCase() },
    ]);

    assert.deepEqual(result.thoughts, [
      { timeInSession: 12, text: "one", clientThoughtId: id },
      { timeInSession: 58, text: "two", clientThoughtId: id },
    ]);
    assert.equal(hasRejectedSubmittedThoughts(result), false);
  });

  it("reads an absent or null id as none, leaving the thought as it was before ids", () => {
    const result = normalizeThoughtInputs([
      { timeInSession: 12, text: "absent" },
      { timeInSession: 58, text: "null", clientThoughtId: null },
    ]);

    assert.deepEqual(result.thoughts, [
      { timeInSession: 12, text: "absent" },
      { timeInSession: 58, text: "null" },
    ]);
    assert.equal(hasRejectedSubmittedThoughts(result), false);
  });

  it("flags an id that is not a UUID string instead of storing the thought without one", () => {
    for (const raw of ["", "not-a-uuid", `${id}0`, id.replace(/-/g, ""), 948, {}, true]) {
      const result = normalizeThoughtInputs([{ timeInSession: 12, text: "kept", clientThoughtId: raw }]);
      assert.equal(result.invalidCount, 1, `id ${JSON.stringify(raw)}`);
      assert.equal(hasRejectedSubmittedThoughts(result), true, `id ${JSON.stringify(raw)}`);
    }
  });
});

describe("parseClearCompletionNote (#792)", () => {
  it("reads an absent flag as false", () => {
    assert.deepEqual(parseClearCompletionNote(undefined), { ok: true, value: false });
  });

  it("accepts both booleans", () => {
    assert.deepEqual(parseClearCompletionNote(true), { ok: true, value: true });
    assert.deepEqual(parseClearCompletionNote(false), { ok: true, value: false });
  });

  it("rejects values that are not booleans instead of coercing them", () => {
    for (const raw of [null, "true", 1, 0, {}, []]) {
      assert.deepEqual(parseClearCompletionNote(raw), { ok: false }, `value ${JSON.stringify(raw)}`);
    }
  });
});
