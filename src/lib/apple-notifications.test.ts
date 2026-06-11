import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  linkLimit,
  fallbackLimit,
  deleteReturning,
  updateSet,
  updateWhere,
  updateReturning,
  insertValues,
  insertReturning,
  deleteUserAccount,
} = vi.hoisted(() => ({
  /** select().from().where().limit() — oauth_accounts link lookup */
  linkLimit: vi.fn(),
  /** select().from().where().orderBy().limit() — audit-log fallback lookup */
  fallbackLimit: vi.fn(),
  deleteReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  deleteUserAccount: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: linkLimit,
          orderBy: () => ({ limit: fallbackLimit }),
        }),
      }),
    }),
    delete: () => ({ where: () => ({ returning: deleteReturning }) }),
    update: () => ({
      set: (values: unknown) => {
        updateSet(values);
        return {
          where: (...args: unknown[]) => {
            updateWhere(...args);
            const result = Promise.resolve(undefined);
            return Object.assign(result, { returning: updateReturning });
          },
        };
      },
    }),
    insert: () => ({
      values: (values: unknown) => {
        insertValues(values);
        return { returning: insertReturning };
      },
    }),
  },
}));

vi.mock("@/lib/accountDeletion", () => ({
  deleteUserAccount,
}));

import {
  finalizeAppleNotificationLog,
  handleAppleNotificationEvent,
  parseAppleEventsClaim,
  recordAppleNotificationReceipt,
} from "./apple-notifications";

beforeEach(() => {
  vi.clearAllMocks();
  linkLimit.mockResolvedValue([{ userId: "user-uuid-1" }]);
  fallbackLimit.mockResolvedValue([]);
  deleteReturning.mockResolvedValue([{ id: "link-1" }]);
  updateReturning.mockResolvedValue([{ id: "user-uuid-1" }]);
  insertReturning.mockResolvedValue([{ id: "log-uuid-1" }]);
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

  test("account-delete after consent-revoked still deletes via the audit-log fallback", async () => {
    // consent-revoked removed the oauth link; the audit log still maps sub -> user.
    linkLimit.mockResolvedValue([]);
    fallbackLimit.mockResolvedValue([{ userId: "user-uuid-1" }]);

    const result = await handleAppleNotificationEvent({ type: "account-delete", sub: "apple-sub-1" });

    expect(deleteUserAccount).toHaveBeenCalledWith("user-uuid-1");
    expect(result).toEqual({ actionTaken: "account_deleted", userId: "user-uuid-1" });
  });

  test("account-delete is a noop when deleteUserAccount finds nothing", async () => {
    deleteUserAccount.mockResolvedValue(false);
    const result = await handleAppleNotificationEvent({ type: "account-delete", sub: "apple-sub-1" });

    expect(result).toEqual({ actionTaken: "noop_already_deleted", userId: "user-uuid-1" });
  });

  test("account-delete with a never-seen sub does not call deleteUserAccount", async () => {
    linkLimit.mockResolvedValue([]);
    fallbackLimit.mockResolvedValue([]);
    const result = await handleAppleNotificationEvent({ type: "account-delete", sub: "gone-sub" });

    expect(deleteUserAccount).not.toHaveBeenCalled();
    expect(result).toEqual({ actionTaken: "noop_user_not_found", userId: null });
  });

  test("consent-revoked deletes the apple oauth link", async () => {
    const result = await handleAppleNotificationEvent({ type: "consent-revoked", sub: "apple-sub-1" });

    expect(deleteReturning).toHaveBeenCalled();
    expect(result).toEqual({ actionTaken: "apple_link_removed", userId: "user-uuid-1" });
  });

  test("consent-revoked reports noop when the link is already gone", async () => {
    deleteReturning.mockResolvedValue([]);
    const result = await handleAppleNotificationEvent({ type: "consent-revoked", sub: "apple-sub-1" });

    expect(result).toEqual({ actionTaken: "noop_link_already_removed", userId: "user-uuid-1" });
  });

  test("email-disabled marks the user undeliverable", async () => {
    const result = await handleAppleNotificationEvent({ type: "email-disabled", sub: "apple-sub-1" });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ emailDeliverable: false }));
    expect(result).toEqual({ actionTaken: "email_marked_undeliverable", userId: "user-uuid-1" });
  });

  test("email-enabled marks the user deliverable again", async () => {
    const result = await handleAppleNotificationEvent({ type: "email-enabled", sub: "apple-sub-1" });

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ emailDeliverable: true }));
    expect(result).toEqual({ actionTaken: "email_marked_deliverable", userId: "user-uuid-1" });
  });

  test("email-enabled for a fallback-resolved but deleted user is a noop", async () => {
    linkLimit.mockResolvedValue([]);
    fallbackLimit.mockResolvedValue([{ userId: "user-uuid-1" }]);
    updateReturning.mockResolvedValue([]);

    const result = await handleAppleNotificationEvent({ type: "email-enabled", sub: "apple-sub-1" });

    expect(result).toEqual({ actionTaken: "noop_user_not_found", userId: "user-uuid-1" });
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

describe("recordAppleNotificationReceipt", () => {
  test("inserts a received row and returns its id", async () => {
    const id = await recordAppleNotificationReceipt({
      eventType: "consent-revoked",
      subject: "apple-sub-1",
      eventTime: 1_718_000_000_000,
      jti: "jti-abc",
    });

    expect(id).toBe("log-uuid-1");
    expect(insertValues).toHaveBeenCalledWith({
      eventType: "consent-revoked",
      subject: "apple-sub-1",
      eventTime: new Date(1_718_000_000_000),
      jti: "jti-abc",
      actionTaken: "received",
    });
  });

  test("tolerates missing event_time and jti", async () => {
    await recordAppleNotificationReceipt({
      eventType: "email-enabled",
      subject: "apple-sub-1",
      eventTime: undefined,
      jti: undefined,
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ eventTime: null, jti: null }),
    );
  });

  test("truncates an oversized external event type instead of failing the insert", async () => {
    const longType = "x".repeat(80);
    await recordAppleNotificationReceipt({
      eventType: longType,
      subject: "apple-sub-1",
      eventTime: undefined,
      jti: undefined,
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "x".repeat(50) }),
    );
  });
});

describe("finalizeAppleNotificationLog", () => {
  test("updates the receipt row with the handler outcome", async () => {
    await finalizeAppleNotificationLog("log-uuid-1", {
      actionTaken: "apple_link_removed",
      userId: "user-uuid-1",
    });

    expect(updateSet).toHaveBeenCalledWith({
      actionTaken: "apple_link_removed",
      userId: "user-uuid-1",
    });
    expect(updateWhere).toHaveBeenCalled();
  });
});
