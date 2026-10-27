/**
 * Issue #1004 — the pure mappings extracted from `useSessionSaveLifecycle`.
 *
 * The hook's own tests drive these through React; these pin each rule directly:
 * what a standard, breath, and focus save sends, what the completion screen
 * shows, and when a retry may change it.
 */
import { describe, expect, test } from "vitest";
import type { User } from "@/lib/api";
import { previewNextCombinedDuration } from "@/lib/combinedSit";
import {
  applyRetryOutcome,
  buildBreathSessionRequest,
  buildCompletionData,
  buildFocusSessionRequest,
  buildStandardSitRequest,
  type CompletedSitInput,
  type CompletionData,
} from "@/lib/sessionSaveLifecycleLogic";
import { previewNextStandardDuration } from "@/lib/userProgression";

const clientSessionId = "550e8400-e29b-41d4-a716-446655441004";

function sitInput(overrides: Partial<CompletedSitInput> = {}): CompletedSitInput {
  return {
    sitKey: "sit-1004",
    dayNumber: 7,
    sessionType: "standard",
    track: "primary",
    duration: 420,
    bonusSeconds: 15,
    completed: true,
    actualTime: 435,
    clearPercent: 62,
    thoughtCount: 2,
    mindStateLog: [{ time: 10, state: "clear" }],
    thoughts: [{ timeInSession: 30, text: "noticed" }],
    ...overrides,
  };
}

function userAt(overrides: Partial<User> = {}): User {
  return {
    currentDay: 7,
    secondTrackDay: 3,
    ...overrides,
  } as User;
}

describe("buildStandardSitRequest (#1004)", () => {
  test("a completed sit carries every field it was given, and the pinned date", () => {
    expect(buildStandardSitRequest(sitInput(), "2026-10-27", true)).toEqual({
      dayNumber: 7,
      sessionType: "standard",
      track: "primary",
      duration: 420,
      bonusSeconds: 15,
      completed: true,
      actualTime: 435,
      clearPercent: 62,
      thoughtCount: 2,
      mindStateLog: [{ time: 10, state: "clear" }],
      sessionDate: "2026-10-27",
    });
  });

  test("abandonment differs only in `completed`, whatever the input says", () => {
    const input = sitInput({ completed: true });
    const completed = buildStandardSitRequest(input, "2026-10-27", true);
    const abandoned = buildStandardSitRequest(input, "2026-10-27", false);
    expect(abandoned).toEqual({ ...completed, completed: false });
  });

  test("the request leaves out the gate's sit key and the thoughts", () => {
    const request = buildStandardSitRequest(sitInput(), "2026-10-27", true);
    expect(request).not.toHaveProperty("sitKey");
    expect(request).not.toHaveProperty("thoughts");
  });

  test("`combined` is present only on a combined sit (#769)", () => {
    expect(buildStandardSitRequest(sitInput(), "2026-10-27", true)).not.toHaveProperty("combined");
    expect(buildStandardSitRequest(sitInput({ combined: false }), "2026-10-27", true))
      .not.toHaveProperty("combined");
    expect(buildStandardSitRequest(sitInput({ combined: true }), "2026-10-27", true))
      .toHaveProperty("combined", true);
    expect(buildStandardSitRequest(sitInput({ combined: true }), "2026-10-27", false))
      .toHaveProperty("combined", true);
  });
});

describe("buildBreathSessionRequest (#376)", () => {
  test("a breath session is completed, with no thoughts or clarity", () => {
    expect(
      buildBreathSessionRequest({ elapsedSeconds: 95, breathCount: 12, tapCount: 24 }, 4, "2026-10-26"),
    ).toEqual({
      dayNumber: 4,
      sessionType: "breath",
      duration: 95,
      bonusSeconds: 0,
      completed: true,
      actualTime: 95,
      clearPercent: 0,
      thoughtCount: 0,
      breathCount: 12,
      mindStateLog: [],
      sessionDate: "2026-10-26",
    });
  });

  test("the planned duration is never under one second", () => {
    const request = buildBreathSessionRequest({ elapsedSeconds: 0, breathCount: 0, tapCount: 1 }, 1, "2026-10-27");
    expect(request.duration).toBe(1);
    expect(request.actualTime).toBe(0);
  });
});

describe("buildFocusSessionRequest (#836)", () => {
  test("a focus session carries its category and the calendar date it was given", () => {
    expect(
      buildFocusSessionRequest({ duration: 1500, actualTime: 1500, completed: true }, 3, "reading", "2026-10-27"),
    ).toEqual({
      dayNumber: 3,
      sessionType: "focus",
      focusCategory: "reading",
      duration: 1500,
      bonusSeconds: 0,
      completed: true,
      actualTime: 1500,
      clearPercent: 0,
      thoughtCount: 0,
      mindStateLog: [],
      sessionDate: "2026-10-27",
    });
  });

  test("no category chosen is saved as null (#837)", () => {
    const request = buildFocusSessionRequest({ duration: 600, actualTime: 200, completed: false }, 1, null, "2026-10-27");
    expect(request.focusCategory).toBeNull();
    expect(request.completed).toBe(false);
  });
});

describe("buildCompletionData (#703)", () => {
  test("a synced sit is neither pending nor not stored", () => {
    const data = buildCompletionData(sitInput(), { status: "synced", sessionId: "server-1" }, clientSessionId, userAt());
    expect(data).toMatchObject({
      sessionId: "server-1",
      clientSessionId,
      isPendingSync: false,
      notStored: false,
      dayNumber: 7,
      sessionType: "standard",
      track: "primary",
      duration: 420,
      bonusSeconds: 15,
      clearPercent: 62,
      thoughtCount: 2,
      thoughts: [{ timeInSession: 30, text: "noticed" }],
    });
  });

  test("a pending sit is pending, never not stored", () => {
    const data = buildCompletionData(sitInput(), { status: "pending", sessionId: clientSessionId }, clientSessionId, userAt());
    expect(data.isPendingSync).toBe(true);
    expect(data.notStored).toBe(false);
    expect(data.sessionId).toBe(clientSessionId);
  });

  test("a sit not stored is not stored, never pending", () => {
    const data = buildCompletionData(sitInput(), { status: "notStored", sessionId: null }, clientSessionId, userAt());
    expect(data.notStored).toBe(true);
    expect(data.isPendingSync).toBe(false);
    expect(data.sessionId).toBeNull();
  });

  test("no save at all shows neither flag and no session id", () => {
    const data = buildCompletionData(sitInput(), null, clientSessionId, null);
    expect(data.notStored).toBe(false);
    expect(data.isPendingSync).toBe(false);
    expect(data.sessionId).toBeNull();
    expect(data.clientSessionId).toBe(clientSessionId);
  });

  test("an ordinary sit previews the next standard sit", () => {
    const user = userAt();
    const data = buildCompletionData(sitInput(), { status: "synced", sessionId: "s" }, clientSessionId, user);
    expect(data.nextDuration).toBe(previewNextStandardDuration("standard", true, "primary", user));
  });

  test("a combined sit previews what the next two sits add up to (#769)", () => {
    const user = userAt({ currentDay: 9, secondTrackDay: 4 });
    const data = buildCompletionData(
      sitInput({ combined: true }),
      { status: "synced", sessionId: "s" },
      clientSessionId,
      user,
    );
    expect(data.nextDuration).toBe(previewNextCombinedDuration({ completed: true, currentDay: 9, secondTrackDay: 4 }));
  });

  test("a combined sit with no user falls back to the standard preview", () => {
    const data = buildCompletionData(sitInput({ combined: true }), null, clientSessionId, null);
    expect(data.nextDuration).toBe(previewNextStandardDuration("standard", true, "primary", null));
  });
});

describe("applyRetryOutcome (#703)", () => {
  function screen(overrides: Partial<CompletionData> = {}): CompletionData {
    return {
      ...buildCompletionData(sitInput(), { status: "notStored", sessionId: null }, clientSessionId, userAt()),
      ...overrides,
    };
  }

  test("no screen stays no screen", () => {
    expect(applyRetryOutcome(null, clientSessionId, { status: "synced", sessionId: "s" })).toBeNull();
  });

  test("a screen showing another sit is returned unchanged", () => {
    const previous = screen({ clientSessionId: "another-sit" });
    expect(applyRetryOutcome(previous, clientSessionId, { status: "synced", sessionId: "s" })).toBe(previous);
  });

  test("this sit's screen takes the stored outcome", () => {
    const previous = screen();
    expect(applyRetryOutcome(previous, clientSessionId, { status: "pending", sessionId: clientSessionId })).toEqual({
      ...previous,
      sessionId: clientSessionId,
      isPendingSync: true,
      notStored: false,
    });
    expect(applyRetryOutcome(previous, clientSessionId, { status: "synced", sessionId: "server-2" })).toEqual({
      ...previous,
      sessionId: "server-2",
      isPendingSync: false,
      notStored: false,
    });
  });
});
