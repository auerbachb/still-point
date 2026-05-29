import { describe, expect, test } from "vitest";
import {
  BUDDY_CALENDAR_DEFAULT_DAYS,
  buddyColorFromUserId,
  buddySessionCalendarDate,
  parseBuddyCalendarRange,
} from "./buddyCalendar";
import { addDaysToIsoDate } from "./sessionCalendar";

describe("buddyColorFromUserId", () => {
  test("returns stable color for the same id", () => {
    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    expect(buddyColorFromUserId(id)).toBe(buddyColorFromUserId(id));
  });

  test("returns different colors for different ids when palette allows", () => {
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    expect(buddyColorFromUserId(a)).not.toBe(buddyColorFromUserId(b));
  });
});

describe("buddySessionCalendarDate", () => {
  test("prefers startedAt over scheduled and created", () => {
    expect(
      buddySessionCalendarDate({
        startedAt: new Date("2024-06-15T18:00:00.000Z"),
        scheduledStartAt: new Date("2024-06-14T10:00:00.000Z"),
        createdAt: new Date("2024-06-10T08:00:00.000Z"),
      }),
    ).toBe("2024-06-15");
  });

  test("uses scheduledStartAt when not started", () => {
    expect(
      buddySessionCalendarDate({
        startedAt: null,
        scheduledStartAt: new Date("2024-07-01T12:00:00.000Z"),
        createdAt: new Date("2024-06-28T08:00:00.000Z"),
      }),
    ).toBe("2024-07-01");
  });
});

describe("parseBuddyCalendarRange", () => {
  test("defaults to 90-day window ending today", () => {
    const to = "2025-05-29";
    const params = new URLSearchParams({ to });
    const range = parseBuddyCalendarRange(params);
    expect(range.toDate).toBe(to);
    expect(range.fromDate).toBe(
      addDaysToIsoDate(to, -(BUDDY_CALENDAR_DEFAULT_DAYS - 1)),
    );
    expect(range.limit).toBe(200);
    expect(range.offset).toBe(0);
  });

  test("rejects invalid to date", () => {
    expect(() =>
      parseBuddyCalendarRange(new URLSearchParams({ to: "not-a-date" })),
    ).toThrow("INVALID_TO_DATE");
  });
});
