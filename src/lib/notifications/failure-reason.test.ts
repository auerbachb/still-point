import { describe, expect, test } from "vitest";
import {
  buildFailureReasonReminderPayload,
  buildFailureReasonReminderWebPushPayload,
  FAILURE_REASON_NOTIFICATION_TYPE,
  FAILURE_REASON_REMINDER_MINUTES,
} from "./failure-reason";

describe("failure reason reminder helpers", () => {
  test("fixed trigger is 8 PM local (1200 minutes since midnight)", () => {
    expect(FAILURE_REASON_REMINDER_MINUTES).toBe(20 * 60);
  });

  test("yesterday APNs payload uses the catch-up copy and dated deep link", () => {
    const payload = buildFailureReasonReminderPayload("2026-05-28", true);
    expect(payload.aps.alert).toMatchObject({
      title: "Still Point",
      body: "You didn't meditate yesterday. Take a moment to log why.",
    });
    expect(payload.type).toBe(FAILURE_REASON_NOTIFICATION_TYPE);
    expect(payload.deepLink).toBe("stillpoint://log-reason?date=2026-05-28");
  });

  test("today APNs payload uses the still-time copy", () => {
    const payload = buildFailureReasonReminderPayload("2026-05-29", false);
    expect(payload.aps.alert).toMatchObject({
      body: "Still time to meditate! Log why you can't, or start a quick session.",
    });
    expect(payload.deepLink).toBe("stillpoint://log-reason?date=2026-05-29");
  });

  test("web push payload mirrors the copy and points at the log page", () => {
    const yesterday = buildFailureReasonReminderWebPushPayload("2026-05-28", true);
    expect(yesterday).toEqual({
      title: "Still Point",
      body: "You didn't meditate yesterday. Take a moment to log why.",
      type: FAILURE_REASON_NOTIFICATION_TYPE,
      url: "/app/log-reason?date=2026-05-28",
    });

    const today = buildFailureReasonReminderWebPushPayload("2026-05-29", false);
    expect(today.url).toBe("/app/log-reason?date=2026-05-29");
    expect(today.body).toContain("Still time to meditate");
  });
});
