import "server-only";

import crypto from "crypto";
import { db } from "@/db";
import {
  buddySessionCalendarEvents,
  buddySessions,
  googleOAuthTokens,
  users,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_EVENTS_URL =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];
const GOOGLE_STATE_COOKIE = "sp_google_oauth_state";
const TOKEN_REFRESH_SKEW_MS = 60_000;

export class GoogleCalendarUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarUnavailableError";
  }
}

export class GoogleCalendarApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "GoogleCalendarApiError";
    this.status = status;
    this.body = body;
  }
}

export type GoogleOAuthState = {
  state: string;
  cookie: {
    name: string;
    value: string;
    maxAge: number;
    path: string;
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
  };
};

export type CalendarSyncResult =
  | { status: "created"; userId: string; eventId: string; htmlLink: string | null }
  | { status: "skipped"; userId: string; reason: "not_connected" | "not_scheduled" }
  | { status: "failed"; userId: string; error: string };

export type GoogleCalendarStatus = {
  connected: boolean;
  email: string | null;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEventResponse = {
  id?: string;
  htmlLink?: string;
};

function requireGoogleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = getGoogleRedirectUri();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new GoogleCalendarUnavailableError(
      "Google Calendar is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

function getGoogleRedirectUri(): string | null {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!origin) return null;
  return `${origin.replace(/\/+$/, "")}/api/auth/google/callback`;
}

function requireEncryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new GoogleCalendarUnavailableError(
      "GOOGLE_TOKEN_ENCRYPTION_KEY is not set. Generate 32 bytes with `openssl rand -base64 32`.",
    );
  }
  const fromBase64 = Buffer.from(raw, "base64");
  if (fromBase64.length === 32) return fromBase64;
  const fromHex = Buffer.from(raw, "hex");
  if (fromHex.length === 32) return fromHex;
  throw new GoogleCalendarUnavailableError(
    "GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (base64 or hex).",
  );
}

export function makeGoogleOAuthState(userId: string): GoogleOAuthState {
  const nonce = crypto.randomBytes(16).toString("base64url");
  const state = Buffer.from(JSON.stringify({ userId, nonce }), "utf8").toString("base64url");
  return {
    state,
    cookie: {
      name: GOOGLE_STATE_COOKIE,
      value: nonce,
      maxAge: 10 * 60,
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  };
}

export function verifyGoogleOAuthState(
  state: string | null,
  nonceCookie: string | undefined,
  expectedUserId: string,
): boolean {
  if (!state || !nonceCookie) return false;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      userId?: unknown;
      nonce?: unknown;
    };
    return parsed.userId === expectedUserId && parsed.nonce === nonceCookie;
  } catch {
    return false;
  }
}

export function getGoogleStateCookieName(): string {
  return GOOGLE_STATE_COOKIE;
}

export function buildGoogleAuthUrl(state: string): string {
  const { clientId, redirectUri } = requireGoogleClientConfig();
  const url = new URL(GOOGLE_AUTH_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

function encryptToken(token: string): string {
  const key = requireEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptToken(payload: string): string {
  const key = requireEncryptionKey();
  const [ivRaw, tagRaw, ciphertextRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) {
    throw new GoogleCalendarUnavailableError("Stored Google token is malformed.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function parseGoogleError(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function googleErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const errorDescription = o.error_description;
    if (typeof errorDescription === "string" && errorDescription.trim()) {
      return errorDescription;
    }
    const error = o.error;
    if (typeof error === "string" && error.trim()) return error;
    const message = o.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof body === "string" && body.trim()) return body;
  return fallback;
}

async function googleJsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await parseGoogleError(res);
    throw new GoogleCalendarApiError(googleErrorMessage(body, `Google API failed (${res.status})`), res.status, body);
  }
  return (await res.json()) as T;
}

export async function exchangeGoogleCodeForTokens(
  code: string,
  userId: string,
): Promise<void> {
  const { clientId, clientSecret, redirectUri } = requireGoogleClientConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const token = await googleJsonFetch<GoogleTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!token.access_token || !token.expires_in) {
    throw new GoogleCalendarApiError("Google token response was incomplete", 200, token);
  }

  const userInfo = await googleJsonFetch<{ sub?: string; email?: string }>(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + token.expires_in * 1000);
  const existing = await getGoogleOAuthToken(userId);
  await db
    .insert(googleOAuthTokens)
    .values({
      userId,
      googleSub: typeof userInfo.sub === "string" ? userInfo.sub : null,
      googleEmail: typeof userInfo.email === "string" ? userInfo.email : null,
      accessTokenEncrypted: encryptToken(token.access_token),
      refreshTokenEncrypted: token.refresh_token
        ? encryptToken(token.refresh_token)
        : existing?.refreshTokenEncrypted ?? null,
      scope: token.scope ?? GOOGLE_SCOPES.join(" "),
      tokenType: token.token_type ?? "Bearer",
      expiryDate: expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: googleOAuthTokens.userId,
      set: {
        googleSub: typeof userInfo.sub === "string" ? userInfo.sub : null,
        googleEmail: typeof userInfo.email === "string" ? userInfo.email : null,
        accessTokenEncrypted: encryptToken(token.access_token),
        refreshTokenEncrypted: token.refresh_token
          ? encryptToken(token.refresh_token)
          : existing?.refreshTokenEncrypted ?? null,
        scope: token.scope ?? GOOGLE_SCOPES.join(" "),
        tokenType: token.token_type ?? "Bearer",
        expiryDate: expiresAt,
        updatedAt: now,
      },
    });
}

export async function getGoogleOAuthToken(userId: string) {
  const [token] = await db
    .select()
    .from(googleOAuthTokens)
    .where(eq(googleOAuthTokens.userId, userId))
    .limit(1);
  return token ?? null;
}

async function refreshAccessToken(userId: string, refreshTokenEncrypted: string): Promise<string> {
  const { clientId, clientSecret } = requireGoogleClientConfig();
  const refreshToken = decryptToken(refreshTokenEncrypted);
  const token = await googleJsonFetch<GoogleTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!token.access_token || !token.expires_in) {
    throw new GoogleCalendarApiError("Google refresh response was incomplete", 200, token);
  }
  const now = new Date();
  await db
    .update(googleOAuthTokens)
    .set({
      accessTokenEncrypted: encryptToken(token.access_token),
      scope: token.scope ?? GOOGLE_SCOPES.join(" "),
      tokenType: token.token_type ?? "Bearer",
      expiryDate: new Date(now.getTime() + token.expires_in * 1000),
      updatedAt: now,
    })
    .where(eq(googleOAuthTokens.userId, userId));
  return token.access_token;
}

async function getValidAccessToken(userId: string): Promise<string | null> {
  const token = await getGoogleOAuthToken(userId);
  if (!token) return null;
  if (token.expiryDate.getTime() > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return decryptToken(token.accessTokenEncrypted);
  }
  if (!token.refreshTokenEncrypted) return null;
  return refreshAccessToken(userId, token.refreshTokenEncrypted);
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

async function insertCalendarEvent(
  userId: string,
  session: typeof buddySessions.$inferSelect,
  accessToken: string,
): Promise<GoogleCalendarEventResponse> {
  if (!session.scheduledStartAt) {
    throw new GoogleCalendarUnavailableError("Cannot create a calendar event without scheduledStartAt.");
  }
  const start = session.scheduledStartAt;
  const end = new Date(start.getTime() + session.durationSeconds * 1000);
  return googleJsonFetch<GoogleCalendarEventResponse>(GOOGLE_CALENDAR_EVENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
}

export async function syncBuddySessionCalendarForUser(
  session: typeof buddySessions.$inferSelect,
  userId: string,
): Promise<CalendarSyncResult> {
  if (!session.scheduledStartAt) {
    return { status: "skipped", userId, reason: "not_scheduled" };
  }
  try {
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) return { status: "skipped", userId, reason: "not_connected" };
    const [existingEvent] = await db
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
    const event = await insertCalendarEvent(userId, session, accessToken);
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
    return { status: "failed", userId, error: message };
  }
}

export async function loadGoogleCalendarStatus(userId: string) {
  const token = await getGoogleOAuthToken(userId);
  return token
    ? {
        connected: true,
        email: token.googleEmail,
      }
    : { connected: false, email: null };
}

