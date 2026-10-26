import { describe, expect, test } from "vitest";
import type { User } from "./api";
import { NO_RECOVERY, previewNextStandardDuration, recoveryFieldsOf } from "./userProgression";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "u-1",
    email: "sitter@example.com",
    username: "sitter",
    isPublic: false,
    currentDay: 5,
    aphorismsEnabled: false,
    ...overrides,
  };
}

describe("recoveryFieldsOf", () => {
  test("turns missing recovery fields into nulls", () => {
    expect(recoveryFieldsOf(makeUser())).toEqual(NO_RECOVERY);
  });

  test("passes an active recovery ramp through", () => {
    const user = makeUser({ recoveryTargetDay: 20, recoveryCurrentStep: 2, recoveryTotalSteps: 5 });
    expect(recoveryFieldsOf(user)).toEqual({
      recoveryTargetDay: 20,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
  });
});

describe("previewNextStandardDuration", () => {
  test("falls back to one minute with no user", () => {
    expect(previewNextStandardDuration("standard", true, "primary", null)).toBe(60);
  });

  test("a completed standard sit previews the next day's length", () => {
    // Day 5 is 100s; finishing it moves the user to day 6 (110s).
    expect(previewNextStandardDuration("standard", true, "primary", makeUser())).toBe(110);
  });

  test("an abandoned or quick sit does not advance the day", () => {
    expect(previewNextStandardDuration("standard", false, "primary", makeUser())).toBe(100);
    expect(previewNextStandardDuration("quick", true, "primary", makeUser())).toBe(100);
  });

  test("a recovery sit previews the next step of the ramp (#238)", () => {
    const user = makeUser({
      currentDay: 20,
      recoveryTargetDay: 20,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
    // Step 3 of 5 back to day 20 (250s): 60 + 2 * 38 = 136, snapped to 140.
    expect(previewNextStandardDuration("standard", true, "primary", user)).toBe(140);
  });

  test("the final recovery step previews the day after the target", () => {
    const user = makeUser({
      currentDay: 20,
      recoveryTargetDay: 20,
      recoveryCurrentStep: 5,
      recoveryTotalSteps: 5,
    });
    expect(previewNextStandardDuration("standard", true, "primary", user)).toBe(260);
  });

  test("the second track uses its own counter and ignores the recovery ramp (#240)", () => {
    const user = makeUser({
      secondTrackDay: 3,
      recoveryTargetDay: 20,
      recoveryCurrentStep: 2,
      recoveryTotalSteps: 5,
    });
    expect(previewNextStandardDuration("standard", true, "second", user)).toBe(90);
    expect(previewNextStandardDuration("standard", false, "second", user)).toBe(80);
  });

  test("a second track with no counter yet starts from day one", () => {
    expect(previewNextStandardDuration("standard", true, "second", makeUser())).toBe(70);
  });
});
