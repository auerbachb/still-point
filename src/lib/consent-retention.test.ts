import { describe, expect, test } from "vitest";
import { CONSENT_RETENTION_YEARS, consentRetentionCutoff } from "./consent-retention";

describe("consentRetentionCutoff (#789)", () => {
  test("is the same UTC instant five calendar years earlier", () => {
    expect(CONSENT_RETENTION_YEARS).toBe(5);
    expect(consentRetentionCutoff(new Date("2031-06-15T12:00:00.000Z")).toISOString()).toBe(
      "2026-06-15T12:00:00.000Z",
    );
    expect(consentRetentionCutoff(new Date("2031-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("clamps Feb 29 to Feb 28 instead of rolling forward into March", () => {
    // Rolling forward to 2027-03-01 would purge events from 2027-02-28 onward,
    // which are not yet five years old on 2032-02-29.
    expect(consentRetentionCutoff(new Date("2032-02-29T04:00:00.000Z")).toISOString()).toBe(
      "2027-02-28T04:00:00.000Z",
    );
  });

  test("leaves the dates around a leap day five years back unchanged", () => {
    expect(consentRetentionCutoff(new Date("2033-02-28T04:00:00.000Z")).toISOString()).toBe(
      "2028-02-28T04:00:00.000Z",
    );
    expect(consentRetentionCutoff(new Date("2033-03-01T04:00:00.000Z")).toISOString()).toBe(
      "2028-03-01T04:00:00.000Z",
    );
  });

  test("does not mutate the reference time", () => {
    const now = new Date("2031-06-15T12:00:00.000Z");
    consentRetentionCutoff(now);
    expect(now.toISOString()).toBe("2031-06-15T12:00:00.000Z");
  });

  test("rejects an invalid reference time rather than purging against NaN", () => {
    expect(() => consentRetentionCutoff(new Date("not a date"))).toThrow(RangeError);
  });
});
