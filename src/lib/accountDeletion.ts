import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
import { accountDeletionLog, users } from "@/db/schema";

export function getAccountDeletionEmailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function wasAccountDeleted(email: string): Promise<boolean> {
  const [entry] = await db
    .select({ id: accountDeletionLog.id })
    .from(accountDeletionLog)
    .where(eq(accountDeletionLog.emailHash, getAccountDeletionEmailHash(email)))
    .limit(1);

  return Boolean(entry);
}

/**
 * Hard-deletes the `users` row for `userId`. All direct FKs from `users.id` use
 * `ON DELETE CASCADE` in `schema.ts`, so Postgres removes (in dependency order):
 *
 * - `buddy_sessions` (host)
 * - `buddy_session_participants` (participant `user_id`, and rows under deleted buddy sessions)
 * - `sessions` (owner `user_id`; `thoughts` cascade via `session_id`)
 * - `thoughts` (owner `user_id`)
 * - `friend_requests` (from/to)
 * - `friendships` (either side)
 *
 * `sessions.buddy_session_id` → `buddy_sessions` is `ON DELETE SET NULL`, so when a
 * deleted user was the host, other participants keep their personal `sessions` rows with
 * `buddy_session_id` cleared.
 */
export async function deleteUserAccount(userId: string): Promise<boolean> {
  return poolDb.transaction(async (tx) => {
    const [user] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return false;

    // Persist only a lookup hash so login can explain deleted accounts without retaining the email.
    await tx.insert(accountDeletionLog).values({
      userId: user.id,
      emailHash: getAccountDeletionEmailHash(user.email),
    });

    await tx.delete(users).where(eq(users.id, userId));
    return true;
  });
}
