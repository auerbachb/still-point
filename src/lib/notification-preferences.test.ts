import { describe, expect, test } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  friendRequestNotificationsAllowed,
  isValidE164PhoneNumber,
  isValidCallWindow,
  callOptInRequirementsMet,
} from "./notification-preferences";

describe("friendRequestNotificationsAllowed", () => {
  test("requires master push and friend toggle", () => {
    expect(friendRequestNotificationsAllowed({
      pushEnabled: true,
      friendRequestNotificationsEnabled: true,
    })).toBe(true);

    expect(friendRequestNotificationsAllowed({
      pushEnabled: false,
      friendRequestNotificationsEnabled: true,
    })).toBe(false);

    expect(friendRequestNotificationsAllowed({
      pushEnabled: true,
      friendRequestNotificationsEnabled: false,
    })).toBe(false);
  });

  test("defaults friend request notifications to on", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.friendRequestNotificationsEnabled).toBe(true);
  });
});

describe("suppressDuringSession default", () => {
  test("is on by default, so a sit is silent without opting in (#709)", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.suppressDuringSession).toBe(true);
  });

  test("starts with no active session recorded", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.sessionActiveUntil).toBeNull();
  });
});

describe("call preference defaults", () => {
  test("missed-sit call opt-in is off by default", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.callOptIn).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.callPhoneNumber).toBeNull();
    expect(DEFAULT_NOTIFICATION_PREFERENCES.callConsentAt).toBeNull();
    expect(DEFAULT_NOTIFICATION_PREFERENCES.callWindowStart).toBeNull();
    expect(DEFAULT_NOTIFICATION_PREFERENCES.callWindowStop).toBeNull();
  });
});

describe("isValidE164PhoneNumber", () => {
  test("accepts valid E.164 numbers", () => {
    expect(isValidE164PhoneNumber("+15551234567")).toBe(true);
    expect(isValidE164PhoneNumber("+442079460123")).toBe(true);
  });

  test("rejects invalid numbers", () => {
    expect(isValidE164PhoneNumber("5551234567")).toBe(false);
    expect(isValidE164PhoneNumber("+0123456789")).toBe(false);
    expect(isValidE164PhoneNumber("+1555")).toBe(false);
  });
});

describe("isValidCallWindow", () => {
  test("requires distinct HH:MM bounds", () => {
    expect(isValidCallWindow("09:00", "17:00")).toBe(true);
    expect(isValidCallWindow("09:00", "09:00")).toBe(false);
    expect(isValidCallWindow("25:00", "17:00")).toBe(false);
  });
});

describe("callOptInRequirementsMet", () => {
  test("requires phone and window when opting in", () => {
    expect(callOptInRequirementsMet({
      callPhoneNumber: "+15551234567",
      callWindowStart: "09:00",
      callWindowStop: "17:00",
    })).toBe(true);

    expect(callOptInRequirementsMet({
      callPhoneNumber: null,
      callWindowStart: "09:00",
      callWindowStop: "17:00",
    })).toBe(false);
  });
});
