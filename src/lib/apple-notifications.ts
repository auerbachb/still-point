import { and, desc, eq, isNotNull } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db";
import { appleNotificationLog, oauthAccounts, users } from "@/db/schema";
import { deleteUserAccount } from "@/lib/accountDeletion";
import { isUniqueViolation } from "@/lib/dbErrors";

/** Column widths from schema.ts — externally sourced strings are truncated to
 *  fit so a pathological value can never turn an audit insert into a 500. */
const EVENT_TYPE_MAX = 50;
const SUBJECT_MAX = 255;
const JTI_MAX = 255;

/** Fit a JWT `jti` into the audit column without truncating distinct values. */
function storageJti(raw: string): string {
  if (raw.length <= JTI_MAX) return raw;
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

/** One event from the JWT `events` claim of an Apple server-to-server notification. */
export type AppleNotificationEvent = {
  type: string;
  /** Apple `sub` of the affected Apple ID. */
  sub: string;
  /** ms epoch. */
  event_time?: number;
};

/** Outcome of handling one event; persisted verbatim to `apple_notification_log.action_taken`. */
export type AppleNotificationResult = {
  actionTaken: string;
  userId: string | null;
};

/** Parse the JWT `events` claim. Apple documents it as a JSON **string** holding a
 *  single event object; an already-decoded object is tolerated. Returns null when
 *  the claim is missing or malformed. */
export function parseAppleEventsClaim(eventsClaim: unknown): AppleNotificationEvent | null {
  let decoded: unknown = eventsClaim;
  if (typeof eventsClaim === "string") {
    try {
      decoded = JSON.parse(eventsClaim);
    } catch {
      return null;
    }
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return null;
  }
  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.type !== "string" || !candidate.type) return null;
  if (typeof candidate.sub !== "string" || !candidate.sub) return null;
  return {
    type: candidate.type,
    sub: candidate.sub,
    event_time: typeof candidate.event_time === "number" ? candidate.event_time : undefined,
  };
}

async function findUserIdForAppleSub(sub: string): Promise<string | null> {
  const [link] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, "apple"), eq(oauthAccounts.providerAccountId, sub)))
    .limit(1);
  if (link) return link.userId;

  // consent-revoked deletes the oauth link while the user remains, and Apple
  // commonly sends consent-revoked before account-delete. Fall back to the most
  // recent audit row that resolved this subject so later events still find the
  // user; handlers verify current state (returning()/deleteUserAccount) so a
  // stale row degrades to a noop_* action, never a wrong mutation.
  const [prior] = await db
    .select({ userId: appleNotificationLog.userId })
    .from(appleNotificationLog)
    .where(and(eq(appleNotificationLog.subject, sub), isNotNull(appleNotificationLog.userId)))
    .orderBy(desc(appleNotificationLog.receivedAt))
    .limit(1);
  return prior?.userId ?? null;
}

/** Apply one Apple notification event. Every branch is idempotent: a repeat
 *  delivery finds the already-processed state and reports a `noop_*` action
 *  without erroring, so Apple retries and duplicate posts converge. */
export async function handleAppleNotificationEvent(
  event: AppleNotificationEvent,
): Promise<AppleNotificationResult> {
  const userId = await findUserIdForAppleSub(event.sub);

  switch (event.type) {
    // Apple's reference documents `account-deleted`; issue #338 and several
    // integrations in the wild use `account-delete`. Accept both spellings.
    case "account-delete":
    case "account-deleted": {
      // Same transactional path as in-app deletion (#158): cascades user data and
      // writes account_deletion_log. The oauth_accounts link cascades away, so a
      // repeat delivery resolves no user and lands in noop_user_not_found.
      if (!userId) return { actionTaken: "noop_user_not_found", userId: null };
      const deleted = await deleteUserAccount(userId);
      return { actionTaken: deleted ? "account_deleted" : "noop_already_deleted", userId };
    }

    case "consent-revoked": {
      // Drop the Apple link so the next sign-in requires fresh consent. Active
      // sp_token JWTs are stateless and age out at the 7-day expiry; a token
      // blocklist is explicitly out of scope (#338).
      if (!userId) return { actionTaken: "noop_user_not_found", userId: null };
      const removed = await db
        .delete(oauthAccounts)
        .where(and(eq(oauthAccounts.provider, "apple"), eq(oauthAccounts.providerAccountId, event.sub)))
        .returning({ id: oauthAccounts.id });
      return {
        actionTaken: removed.length > 0 ? "apple_link_removed" : "noop_link_already_removed",
        userId,
      };
    }

    case "email-disabled":
    case "email-enabled": {
      if (!userId) return { actionTaken: "noop_user_not_found", userId: null };
      const deliverable = event.type === "email-enabled";
      const updated = await db
        .update(users)
        .set({ emailDeliverable: deliverable, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      // A fallback-resolved user may have been deleted since — 0 rows is a noop.
      if (updated.length === 0) return { actionTaken: "noop_user_not_found", userId };
      return {
        actionTaken: deliverable ? "email_marked_deliverable" : "email_marked_undeliverable",
        userId,
      };
    }

    default:
      return { actionTaken: "ignored_unknown_event_type", userId };
  }
}

/** Append the audit row for a verified notification BEFORE it is handled, with
 *  `action_taken = "received"`. Two-phase logging means a crash mid-handling can
 *  never lose the receipt — the row is finalized with the real action afterwards.
 *  Duplicate deliveries sharing a `jti` return `alreadySeen: true` once handling
 *  has finalized beyond the in-flight `received` / `processing_failed` states (#532). */
export type AppleNotificationReceiptResult = {
  logId: string;
  alreadySeen: boolean;
};

export async function recordAppleNotificationReceipt(params: {
  eventType: string;
  subject: string;
  eventTime: number | undefined;
  jti: string | undefined;
}): Promise<AppleNotificationReceiptResult> {
  const jti = params.jti !== undefined ? storageJti(params.jti) : null;
  const values = {
    eventType: params.eventType.slice(0, EVENT_TYPE_MAX),
    subject: params.subject.slice(0, SUBJECT_MAX),
    eventTime: params.eventTime !== undefined ? new Date(params.eventTime) : null,
    jti,
    actionTaken: "received",
  };

  if (jti !== null) {
    const [existing] = await db
      .select({
        id: appleNotificationLog.id,
        actionTaken: appleNotificationLog.actionTaken,
      })
      .from(appleNotificationLog)
      .where(eq(appleNotificationLog.jti, jti))
      .limit(1);
    if (existing) {
      const retryEligible =
        existing.actionTaken === "received" || existing.actionTaken === "processing_failed";
      return { logId: existing.id, alreadySeen: !retryEligible };
    }
  }

  try {
    const inserted = await db.insert(appleNotificationLog).values(values).returning({
      id: appleNotificationLog.id,
    });
    if (inserted.length === 0) {
      throw new Error("apple_notification_log insert returned no rows");
    }
    return { logId: inserted[0].id, alreadySeen: false };
  } catch (error) {
    if (jti !== null && isUniqueViolation(error)) {
      const [existing] = await db
        .select({
          id: appleNotificationLog.id,
          actionTaken: appleNotificationLog.actionTaken,
        })
        .from(appleNotificationLog)
        .where(eq(appleNotificationLog.jti, jti))
        .limit(1);
      if (!existing) {
        throw new Error("apple_notification_log jti conflict but no existing row");
      }
      const retryEligible =
        existing.actionTaken === "received" || existing.actionTaken === "processing_failed";
      return { logId: existing.id, alreadySeen: !retryEligible };
    }
    throw error;
  }
}

/** Finalize the receipt row with the handler outcome (or `processing_failed`). */
export async function finalizeAppleNotificationLog(
  logId: string,
  result: AppleNotificationResult,
): Promise<void> {
  await db
    .update(appleNotificationLog)
    .set({ actionTaken: result.actionTaken.slice(0, 64), userId: result.userId })
    .where(eq(appleNotificationLog.id, logId));
}
