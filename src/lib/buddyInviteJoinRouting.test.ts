import { describe, expect, test } from "vitest";
import {
  buddyInviteJoinDecision,
  mayStartBuddyInviteJoin,
  overlayHoldsBuddyInvite,
  pathKeepingBuddyInvite,
  type AppOverlay,
} from "./buddyInviteJoinRouting";

const HOLDING: AppOverlay[] = ["session", "breath", "focus", "complete"];

describe("buddyInviteJoinDecision (#990)", () => {
  test("routes when nothing is up", () => {
    expect(buddyInviteJoinDecision({ cancelled: false, overlay: null })).toBe("route");
  });

  test("defers when a sit or its completion screen came up during the request", () => {
    for (const overlay of HOLDING) {
      expect(buddyInviteJoinDecision({ cancelled: false, overlay })).toBe("deferForSession");
    }
  });

  test("routes over the focus category picker, which holds nothing in progress", () => {
    expect(buddyInviteJoinDecision({ cancelled: false, overlay: "focusPicker" })).toBe("route");
  });

  test("a torn-down effect is stale, and outranks a deferral", () => {
    expect(buddyInviteJoinDecision({ cancelled: true, overlay: null })).toBe("stale");
    expect(buddyInviteJoinDecision({ cancelled: true, overlay: "session" })).toBe("stale");
  });
});

describe("mayStartBuddyInviteJoin", () => {
  test("waits for a sit to end and starts otherwise", () => {
    for (const overlay of HOLDING) {
      expect(overlayHoldsBuddyInvite(overlay)).toBe(true);
      expect(mayStartBuddyInviteJoin(overlay)).toBe(false);
    }
    expect(mayStartBuddyInviteJoin(null)).toBe(true);
    expect(mayStartBuddyInviteJoin("focusPicker")).toBe(true);
  });
});

describe("pathKeepingBuddyInvite", () => {
  test("carries a pending invite over", () => {
    expect(pathKeepingBuddyInvite("/app/progress", "?buddy=abc123")).toBe("/app/progress?buddy=abc123");
  });

  test("keeps only the invite and encodes it", () => {
    expect(pathKeepingBuddyInvite("/app/progress", "?view=settings&buddy=a%2Bb")).toBe(
      "/app/progress?buddy=a%2Bb",
    );
  });

  test("leaves the path alone with no invite", () => {
    expect(pathKeepingBuddyInvite("/app/progress", "")).toBe("/app/progress");
    expect(pathKeepingBuddyInvite("/app/progress", "?buddy=%20")).toBe("/app/progress");
    expect(pathKeepingBuddyInvite("/app/progress", "?session=quick")).toBe("/app/progress");
  });
});
