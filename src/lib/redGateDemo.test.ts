import { test } from "vitest";

// RED-gate verification for #422 — DO NOT MERGE. A string is not assignable to
// number, so `tsc --noEmit` must fail the `typecheck` check on this scratch PR.
const _redGateBadType: number = "not a number";

test("red-gate demo", () => {
  void _redGateBadType;
});
