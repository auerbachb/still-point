import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appleNotificationLog, oauthAccounts, users } from "@/db/schema";
import { deleteUserAccount } from "@/lib/accountDeletion";

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
  return link?.userId ?? null;
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
      await db
        .update(users)
        .set({ emailDeliverable: deliverable, updatedAt: new Date() })
        .where(eq(users.id, userId));
      return {
        actionTaken: deliverable ? "email_marked_deliverable" : "email_marked_undeliverable",
        userId,
      };
    }

    default:
      return { actionTaken: "ignored_unknown_event_type", userId };
  }
}

/** Append one row to the apple_notification_log audit table. */
export async function logAppleNotification(params: {
  eventType: string;
  subject: string;
  eventTime: number | undefined;
  jti: string | undefined;
  userId: string | null;
  actionTaken: string;
}): Promise<void> {
  await db.insert(appleNotificationLog).values({
    eventType: params.eventType,
    subject: params.subject,
    eventTime: params.eventTime !== undefined ? new Date(params.eventTime) : null,
    jti: params.jti ?? null,
    userId: params.userId,
    actionTaken: params.actionTaken,
  });
}
