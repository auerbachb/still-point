/**
 * Issue #930 — a sit that has ended takes no second End Early or Abandon.
 *
 * The regression this locks down: while a sit's save was in flight, both
 * buttons stayed live, and each further click saved another sit under a new
 * client id. `SessionView` applies this rule to both buttons and to its three
 * terminal handlers; `SessionView.test.ts` drives the component itself.
 */
import { describe, expect, test } from "vitest";
import { canEndSession } from "./sessionEndGuard";

describe("canEndSession (#930)", () => {
  // The sit ran out, or was ended early or abandoned.
  test("refuses once the sit has ended", () => {
    expect(canEndSession({ sessionFinished: true })).toBe(false);
  });

  // Running or paused: End Early and Abandon end it, as before.
  test("allows ending a sit that has not ended", () => {
    expect(canEndSession({ sessionFinished: false })).toBe(true);
  });
});
