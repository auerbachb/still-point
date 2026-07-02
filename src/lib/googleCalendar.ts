import "server-only";

import crypto from "crypto";
import { db } from "@/db";
import {
  buddySessionCalendarEvents,
  buddySessionParticipants,
  buddySessions,
  users,
} from "@/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { projectedCalendarDurationSeconds } from "@/lib/buddySessionDuration";
import {
  GoogleCalendarApiError,
  GoogleCalendarUnavailableError,
  getValidAccessToken,
  googleJsonFetch,
} from "@/lib/googleOAuth";

const GOOGLE_CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export type CalendarSyncResult =
  | { status: "created"; userId: string; eventId: string; htmlLink: string | null }
  | { status: "skipped"; userId: string; reason: "not_connected" | "not_scheduled" | "sync_in_progress" }
  | { status: "failed"; userId: string; error: string };

export const GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE = "Could not sync Google Calendar";

type GoogleCalendarEventResponse = {
  id?: string;
  htmlLink?: string;
};

function isGoogleCalendarEventConflict(error: unknown): error is GoogleCalendarApiError {
  return error instanceof GoogleCalendarApiError && error.status === 409;
}

function eventDescription(shareToken: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, "");
  const joinLine = appUrl ? `Join: ${appUrl}/app?buddy=${encodeURIComponent(shareToken)}` : "";
  return [
    "Still Point shared buddy meditation.",
    joinLine,
    "Open Still Point at the scheduled time, join the room, and mark ready.",
  ].filter(Boolean).join("\n\n");
}

function googleCalendarEventId(sessionId: string, userId: string): string {
  return `sp${crypto.createHash("sha256").update(`${sessionId}:${userId}`).digest("hex")}`;
}

async function insertCalendarEvent(
  userId: string,
  session: typeof buddySessions.$inferSelect,
  accessToken: string,
  durationSeconds: number,
): Promise<GoogleCalendarEventResponse> {
  if (!session.scheduledStartAt) {
    throw new GoogleCalendarUnavailableError("Cannot create a calendar event without scheduledStartAt.");
  }
  const start = session.scheduledStartAt;
  const end = new Date(start.getTime() + durationSeconds * 1000);
  const eventId = googleCalendarEventId(session.id, userId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  try {
    return await googleJsonFetch<GoogleCalendarEventResponse>(GOOGLE_CALENDAR_EVENTS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: eventId,
        summary: "Still Point buddy session",
        description: eventDescription(session.shareToken),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        reminders: { useDefault: true },
        extendedProperties: {
          private: {
            stillPointBuddySessionId: session.id,
            stillPointUserId: userId,
          },
        },
      }),
    });
  } catch (error) {
    if (!isGoogleCalendarEventConflict(error)) throw error;
    return googleJsonFetch<GoogleCalendarEventResponse>(
      `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`,
      { headers },
    );
  }
}

async function readCalendarEventRow(sessionId: string, userId: string) {
  const [row] = await db
    .select({
      googleEventId: buddySessionCalendarEvents.googleEventId,
      htmlLink: buddySessionCalendarEvents.htmlLink,
      status: buddySessionCalendarEvents.status,
    })
    .from(buddySessionCalendarEvents)
    .where(
      and(
        eq(buddySessionCalendarEvents.buddySessionId, sessionId),
        eq(buddySessionCalendarEvents.userId, userId),
      ),
    )
    .limit(1);
  return row;
}

export async function syncBuddySessionCalendarForUser(
  session: typeof buddySessions.$inferSelect,
  userId: string,
): Promise<CalendarSyncResult> {
  if (!session.scheduledStartAt) {
    return { status: "skipped", userId, reason: "not_scheduled" };
  }
  const scheduledStartAt = session.scheduledStartAt;
  try {
    // Serialize concurrent syncs for the same session/user so only one caller creates the Google event.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext(${session.id} || ':' || ${userId}))`,
    );

    const existingEvent = await readCalendarEventRow(session.id, userId);
    if (existingEvent?.googleEventId && existingEvent.status === "created") {
      return {
        status: "created",
        userId,
        eventId: existingEvent.googleEventId,
        htmlLink: existingEvent.htmlLink ?? null,
      };
    }

    // Claim or reclaim rows without a Google event id (fresh claim, failed retry, or
    // stale placeholder). Rows that already have googleEventId are left untouched.
    const [claimed] = await db
      .insert(buddySessionCalendarEvents)
      .values({
        buddySessionId: session.id,
        userId,
        status: "created",
        googleEventId: null,
        error: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          buddySessionCalendarEvents.buddySessionId,
          buddySessionCalendarEvents.userId,
        ],
        set: {
          status: "created",
          googleEventId: null,
          error: null,
          updatedAt: new Date(),
        },
        where: isNull(buddySessionCalendarEvents.googleEventId),
      })
      .returning({
        id: buddySessionCalendarEvents.id,
        googleEventId: buddySessionCalendarEvents.googleEventId,
      });

    if (!claimed) {
      const synced = await readCalendarEventRow(session.id, userId);
      if (synced?.googleEventId && synced.status === "created") {
        return {
          status: "created",
          userId,
          eventId: synced.googleEventId,
          htmlLink: synced.htmlLink ?? null,
        };
      }
      return { status: "skipped", userId, reason: "sync_in_progress" };
    }

    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      await db
        .delete(buddySessionCalendarEvents)
        .where(
          and(
            eq(buddySessionCalendarEvents.buddySessionId, session.id),
            eq(buddySessionCalendarEvents.userId, userId),
            isNull(buddySessionCalendarEvents.googleEventId),
          ),
        );
      return { status: "skipped", userId, reason: "not_connected" };
    }

    const participantDays = await db
      .select({ currentDay: users.currentDay })
      .from(buddySessionParticipants)
      .innerJoin(users, eq(buddySessionParticipants.userId, users.id))
      .where(
        and(
          eq(buddySessionParticipants.buddySessionId, session.id),
          isNull(buddySessionParticipants.leftAt),
        ),
      );
    const calendarDurationSeconds = projectedCalendarDurationSeconds(
      participantDays.map((row) => row.currentDay),
      new Date(),
      scheduledStartAt,
    );
    const event = await insertCalendarEvent(userId, session, accessToken, calendarDurationSeconds);
    if (!event.id) {
      throw new GoogleCalendarApiError("Google Calendar event response was incomplete", 200, event);
    }
    await db
      .insert(buddySessionCalendarEvents)
      .values({
        buddySessionId: session.id,
        userId,
        googleEventId: event.id,
        htmlLink: event.htmlLink ?? null,
        status: "created",
        error: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          buddySessionCalendarEvents.buddySessionId,
          buddySessionCalendarEvents.userId,
        ],
        set: {
          googleEventId: event.id,
          htmlLink: event.htmlLink ?? null,
          status: "created",
          error: null,
          updatedAt: new Date(),
        },
      });
    return { status: "created", userId, eventId: event.id, htmlLink: event.htmlLink ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Google Calendar event";
    await db
      .insert(buddySessionCalendarEvents)
      .values({
        buddySessionId: session.id,
        userId,
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          buddySessionCalendarEvents.buddySessionId,
          buddySessionCalendarEvents.userId,
        ],
        set: {
          status: "failed",
          error: message,
          updatedAt: new Date(),
        },
      });
    return { status: "failed", userId, error: GOOGLE_CALENDAR_SYNC_FAILED_MESSAGE };
  }
}
