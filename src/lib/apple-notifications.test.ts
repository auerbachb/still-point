import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  selectLimit,
  deleteReturning,
  updateSet,
  updateWhere,
  insertValues,
  deleteUserAccount,
} = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  deleteReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  insertValues: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    delete: () => ({ where: () => ({ returning: deleteReturning }) }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return { where: updateWhere };
      },
    }),
    insert: () => ({ values: insertValues }),
  },
}));

vi.mock("@/lib/accountDeletion", () => ({
  deleteUserAccount,
}));

import {
  handleAppleNotificationEvent,
  logAppleNotification,
  parseAppleEventsClaim,
} from "./apple-notifications";

beforeEach(() => {
  vi.clearAllMocks();
  selectLimit.mockResolvedValue([{ userId: "user-uuid-1" }]);
  deleteReturning.mockResolvedValue([{ id: "link-1" }]);
  updateWhere.mockResolvedValue(undefined);
  insertValues.mockResolvedValue(undefined);
  deleteUserAccount.mockResolvedValue(true);
});

describe("parseAppleEventsClaim", () => {
  test("parses the documented JSON-string form", () => {
    const event = parseAppleEventsClaim(
      JSON.stringify({ type: "consent-revoked", sub: "apple-sub-1", event_time: 1_718_000_000_000 }),
    );
    expect(event).toEqual({
      type: "consent-revoked",
      sub: "apple-sub-1",
      event_time: 1_718_000_000_000,
    });
  });

  test("tolerates an already-decoded object", () => {
    const event = parseAppleEventsClaim({ type: "account-delete", sub: "apple-sub-2" });
    expect(event).toEqual({ type: "account-delete", sub: "apple-sub-2", event_time: undefined });
  });

  test.each([
    ["not json", "{{nope"],
    ["missing type", JSON.stringify({ sub: "s" })],
    ["missing sub", JSON.stringify({ type: "account-delete" })],
    ["array", JSON.stringify([{ type: "account-delete", sub: "s" }])],
    ["null", null],
    ["undefined", undefined],
  ])("returns null for %s", (_label, claim) => {
    expect(parseAppleEventsClaim(claim)).toBeNull();
  });
});

describe("handleAppleNotificationEvent", () => {
  test("account-delete reuses deleteUserAccount and reports account_deleted", async () => {
    const result = await handleAppleNotificationEvent({ type: "account-delete", sub: "apple-sub-1" });

    expect(deleteUserAccount).toHaveBeenCalledWith("user-uuid-1");
    expect(result).toEqual({ actionTaken: "account_deleted", userId: "user-uuid-1" });
  });

  test("account-deleted (Apple's documented spelling) is handled identically", async () => {
    const result = await handleAppleNotificationEvent({ type: "account-deleted", sub: "apple-sub-1" });

    expect(deleteUserAccount).toHaveBeenCalledWith("user-uuid-1");
    expect(result).toEqual({ actionTaken: "account_deleted", userId: "user-uuid-1" });
  });

  test("account-delete is a noop when deleteUserAccount finds nothing", async () => {
    deleteUserAccount.mockResolvedValue(false);
    const result = await handleAppleNotificationEvent({ type: "account-delete", sub: "apple-sub-1" });

    expect(result).toEqual({ actionTaken: "noop_already_deleted", userId: "user-uuid-1" });
  });

  test("account-delete with unknown sub does not call deleteUserAccount (idempotent repeat)", async () => {
    selectLimit.mockResolvedValue([]);
    const result = await handleAppleNotificationEvent({ type: "account-delete", sub: "gone-sub" });

    expect(deleteUserAccount).not.toHaveBeenCalled();
    expect(result).toEqual({ actionTaken: "noop_user_not_found", userId: null });
  });

  test("consent-revoked deletes the apple oauth link", async () => {
    const result = await handleAppleNotificationEvent({ type: "consent-revoked", sub: "apple-sub-1" });

    expect(deleteReturning).toHaveBeenCalled();
    expect(result).toEqual({ actionTaken: "apple_link_removed", userId: "user-uuid-1" });
  });

  test("consent-revoked reports noop when the link is already gone (race)", async () => {
    deleteReturning.mockResolvedValue([]);
    const result = await handleAppleNotificationEvent({ type: "consent-revoked", sub: "apple-sub-1" });

    expect(result).toEqual({ actionTaken: "noop_link_already_removed", userId: "user-uuid-1" });
  });

  test("email-disabled marks the user undeliverable", async () => {
    const result = await handleAppleNotificationEvent({ type: "email-disabled", sub: "apple-sub-1" });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ emailDeliverable: false }),
    );
    expect(result).toEqual({ actionTaken: "email_marked_undeliverable", userId: "user-uuid-1" });
  });

  test("email-enabled marks the user deliverable again", async () => {
    const result = await handleAppleNotificationEvent({ type: "email-enabled", sub: "apple-sub-1" });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ emailDeliverable: true }),
    );
    expect(result).toEqual({ actionTaken: "email_marked_deliverable", userId: "user-uuid-1" });
  });

  test("repeat email-disabled deliveries converge on the same state", async () => {
    const first = await handleAppleNotificationEvent({ type: "email-disabled", sub: "apple-sub-1" });
    const second = await handleAppleNotificationEvent({ type: "email-disabled", sub: "apple-sub-1" });

    expect(first.actionTaken).toBe("email_marked_undeliverable");
    expect(second.actionTaken).toBe("email_marked_undeliverable");
    expect(updateSet).toHaveBeenNthCalledWith(1, expect.objectContaining({ emailDeliverable: false }));
    expect(updateSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ emailDeliverable: false }));
  });

  test("unknown event types are ignored but reported", async () => {
    const result = await handleAppleNotificationEvent({ type: "mystery-event", sub: "apple-sub-1" });

    expect(result).toEqual({ actionTaken: "ignored_unknown_event_type", userId: "user-uuid-1" });
    expect(deleteUserAccount).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
    expect(deleteReturning).not.toHaveBeenCalled();
  });
});

describe("logAppleNotification", () => {
  test("writes one audit row with event metadata", async () => {
    await logAppleNotification({
      eventType: "consent-revoked",
      subject: "apple-sub-1",
      eventTime: 1_718_000_000_000,
      jti: "jti-abc",
      userId: "user-uuid-1",
      actionTaken: "apple_link_removed",
    });

    expect(insertValues).toHaveBeenCalledWith({
      eventType: "consent-revoked",
      subject: "apple-sub-1",
      eventTime: new Date(1_718_000_000_000),
      jti: "jti-abc",
      userId: "user-uuid-1",
      actionTaken: "apple_link_removed",
    });
  });

  test("tolerates missing event_time and jti", async () => {
    await logAppleNotification({
      eventType: "email-enabled",
      subject: "apple-sub-1",
      eventTime: undefined,
      jti: undefined,
      userId: null,
      actionTaken: "noop_user_not_found",
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ eventTime: null, jti: null, userId: null }),
    );
  });
});
