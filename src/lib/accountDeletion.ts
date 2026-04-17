import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

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
  const rows = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return rows.length > 0;
}
