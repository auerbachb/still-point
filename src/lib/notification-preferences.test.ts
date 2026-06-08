import { describe, expect, test } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  friendRequestNotificationsAllowed,
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
