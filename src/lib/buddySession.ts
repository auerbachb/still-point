/**
 * Shared buddy session domain logic (#117). Server is source of truth for timing and state.
 * #118: Extend route handlers and UI for per-user controls (pause, policy, host transfer).
 * #119: Use participantCompletedAt + POST …/participant-complete for journaling hooks.
 */
import { db } from "@/db";
import {
  buddySessions,
  buddySessionParticipants,
  users,
  friendships,
} from "@/db/schema";
import { BASE_DURATION, INCREMENT } from "@/lib/constants";
import { orderedUserPair } from "@/lib/friends";
import { and, eq, sql } from "drizzle-orm";

export type BuddySessionState =
  | "waiting"
  | "ready_check"
  | "active"
  | "completed"
  | "abandoned";

export function buddyDurationForDay(currentDay: number): number {
  return BASE_DURATION + (currentDay - 1) * INCREMENT;
}

export async function assertBuddyFriendshipIfRequired(
  hostUserId: string,
  joinerUserId: string,
): Promise<void> {
  if (process.env.BUDDY_REQUIRE_FRIENDSHIP !== "true") return;
  if (hostUserId === joinerUserId) return;
  const [a, b] = orderedUserPair(hostUserId, joinerUserId);
  const [row] = await db
    .select({ a: friendships.user1Id })
    .from(friendships)
    .where(and(eq(friendships.user1Id, a), eq(friendships.user2Id, b)))
    .limit(1);
  if (!row) {
    const err = new Error("NOT_FRIENDS");
    (err as Error & { code: string }).code = "NOT_FRIENDS";
    throw err;
  }
}

export async function bumpBuddyRevision(sessionId: string): Promise<void> {
  await db
    .update(buddySessions)
    .set({
      revision: sql`${buddySessions.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(buddySessions.id, sessionId));
}

/** Recompute active→completed and waiting↔ready_check. Call after reads/mutations that affect state. */
export async function reconcileBuddySession(sessionId: string): Promise<void> {
  const [session] = await db
    .select()
    .from(buddySessions)
    .where(eq(buddySessions.id, sessionId))
    .limit(1);
  if (!session) return;

  if (session.state === "abandoned" || session.state === "completed") return;

  if (session.state === "active" && session.startedAt) {
    const endMs =
      session.startedAt.getTime() + session.durationSeconds * 1000;
    if (Date.now() >= endMs) {
      await db
        .update(buddySessions)
        .set({
          state: "completed",
          revision: sql`${buddySessions.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(buddySessions.id, sessionId), eq(buddySessions.state, "active")),
        );
    }
    return;
  }

  if (session.state !== "waiting" && session.state !== "ready_check") return;

  const parts = await db
    .select()
    .from(buddySessionParticipants)
    .where(eq(buddySessionParticipants.buddySessionId, sessionId));

  const inLobby = parts.filter((p) => p.leftAt == null);
  const allReady =
    inLobby.length >= 2 && inLobby.every((p) => p.ready);
  const nextLobbyState: BuddySessionState = allReady
    ? "ready_check"
    : "waiting";

  if (nextLobbyState !== session.state) {
    await db
      .update(buddySessions)
      .set({
        state: nextLobbyState,
        revision: sql`${buddySessions.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(buddySessions.id, sessionId));
  }
}

export type BuddyParticipantRow = typeof buddySessionParticipants.$inferSelect;
export type BuddySessionRow = typeof buddySessions.$inferSelect;

const SEEN_WINDOW_MS = 20_000;

export function buildBuddySnapshot(
  session: BuddySessionRow,
  participants: Array<
    BuddyParticipantRow & { username: string }
  >,
  viewerUserId: string,
) {
  const serverNow = new Date();
  let remainingSeconds: number | null = null;
  let elapsedSeconds: number | null = null;
  let endsAt: string | null = null;

  if (session.state === "active" && session.startedAt) {
    const startMs = session.startedAt.getTime();
    elapsedSeconds = Math.max(
      0,
      Math.floor((serverNow.getTime() - startMs) / 1000),
    );
    remainingSeconds = Math.max(
      0,
      session.durationSeconds - elapsedSeconds,
    );
    endsAt = new Date(startMs + session.durationSeconds * 1000).toISOString();
  }

  return {
    id: session.id,
    state: session.state as BuddySessionState,
    revision: session.revision,
    durationSeconds: session.durationSeconds,
    startedAt: session.startedAt?.toISOString() ?? null,
    serverNow: serverNow.toISOString(),
    endsAt,
    elapsedSeconds,
    remainingSeconds,
    hostUserId: session.hostUserId,
    isHost: session.hostUserId === viewerUserId,
    participants: participants.map((p) => ({
      userId: p.userId,
      username: p.username,
      isHost: p.isHost,
      ready: p.ready,
      joinedAt: p.joinedAt.toISOString(),
      leftAt: p.leftAt?.toISOString() ?? null,
      connected:
        p.leftAt == null &&
        serverNow.getTime() - p.lastSeenAt.getTime() <= SEEN_WINDOW_MS,
      participantCompletedAt: p.participantCompletedAt?.toISOString() ?? null,
    })),
  };
}

export async function loadBuddySnapshotContext(sessionId: string) {
  const [session] = await db
    .select()
    .from(buddySessions)
    .where(eq(buddySessions.id, sessionId))
    .limit(1);
  if (!session) return null;

  const parts = await db
    .select({
      p: buddySessionParticipants,
      username: users.username,
    })
    .from(buddySessionParticipants)
    .innerJoin(users, eq(buddySessionParticipants.userId, users.id))
    .where(eq(buddySessionParticipants.buddySessionId, sessionId));

  const participants = parts.map((row) => ({
    ...row.p,
    username: row.username,
  }));

  return { session, participants };
}
