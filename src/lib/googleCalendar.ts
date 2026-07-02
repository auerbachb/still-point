import "server-only";

import crypto from "crypto";
import { db } from "@/db";
import { poolDb } from "@/db/pool";
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
  | { status: "skipped"; userId: string; reason: "not_connected" | "not_scheduled" }
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

export async function syncBuddySessionCalendarForUser(
  session: typeof buddySessions.$inferSelect,
  userId: string,
): Promise<CalendarSyncResult> {
  if (!session.scheduledStartAt) {
    return { status: "skipped", userId, reason: "not_scheduled" };
  }
  const scheduledStartAt = session.scheduledStartAt;
  try {
    return await poolDb.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`buddy-calendar:${session.id}:${userId}`}))`,
      );

      const [existingEvent] = await tx
        .select({
          googleEventId: buddySessionCalendarEvents.googleEventId,
          htmlLink: buddySessionCalendarEvents.htmlLink,
        })
        .from(buddySessionCalendarEvents)
        .where(
          and(
            eq(buddySessionCalendarEvents.buddySessionId, session.id),
            eq(buddySessionCalendarEvents.userId, userId),
            eq(buddySessionCalendarEvents.status, "created"),
          ),
        )
        .limit(1);
      if (existingEvent?.googleEventId) {
        return {
          status: "created",
          userId,
          eventId: existingEvent.googleEventId,
          htmlLink: existingEvent.htmlLink ?? null,
        };
      }
      const accessToken = await getValidAccessToken(userId);
      if (!accessToken) return { status: "skipped", userId, reason: "not_connected" };
      // #361: project the invite duration from the shortest active participant at sync time
      // (+10s/day until the session) so a future scheduled sit shows the length we expect it to
      // reach, not today's length. The in-app timer is still normalized live at start (#349).
      const participantDays = await tx
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
      await tx
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
    });
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
