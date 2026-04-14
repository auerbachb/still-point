import "server-only";

/**
 * Daily.co REST helpers for buddy video rooms (#105). Server-only usage: call from API routes
 * or server actions so `DAILY_API_KEY` never reaches the client. See `.env.example`.
 * https://docs.daily.co/reference/rest-api/rooms
 */

const DAILY_API_BASE = "https://api.daily.co/v1";

export class DailyApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "DailyApiError";
    this.status = status;
    this.body = body;
  }
}

/** True when Daily rejected creating a room because the name is already taken (orphan retry). */
export function isDailyRoomNameConflict(error: DailyApiError): boolean {
  if (error.status !== 400 && error.status !== 409) return false;
  const raw = `${error.message}\n${JSON.stringify(error.body)}`.toLowerCase();
  return (
    raw.includes("already") ||
    raw.includes("exists") ||
    raw.includes("taken") ||
    raw.includes("in use") ||
    raw.includes("duplicate")
  );
}

/** Normalized room payload from `POST /rooms` (fields we rely on for MVP). */
export type DailyCreatedRoom = {
  name: string;
  url: string;
  id?: string;
  created_at?: string;
  config?: Record<string, unknown>;
};

export type CreateDailyRoomOptions = {
  /** Room name; omit for a Daily-generated name. */
  name?: string;
  privacy?: "public" | "private";
  /** Merged into the request `properties` object (e.g. `exp`, `max_participants`). */
  properties?: Record<string, unknown>;
};

function requireDailyApiKey(): string {
  const key = process.env.DAILY_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "DAILY_API_KEY is not set. Add it to your environment for Daily room management (see .env.example).",
    );
  }
  return key;
}

async function parseDailyErrorBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const info = o.info;
    if (typeof info === "string" && info.trim()) return info;
    const err = o.error;
    if (typeof err === "string" && err.trim()) return err;
    const msg = o.message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  if (typeof body === "string" && body.trim()) return body;
  return fallback;
}

async function dailyFetch(path: string, init: RequestInit): Promise<Response> {
  const key = requireDailyApiKey();
  const url = `${DAILY_API_BASE}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${key}`);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
}

/**
 * Creates a Daily room. Uses `DAILY_API_KEY` from the environment only.
 */
export async function createRoom(options: CreateDailyRoomOptions = {}): Promise<DailyCreatedRoom> {
  const body: Record<string, unknown> = {};
  if (options.name !== undefined) body.name = options.name;
  if (options.privacy !== undefined) body.privacy = options.privacy;
  if (options.properties !== undefined && Object.keys(options.properties).length > 0) {
    body.properties = options.properties;
  }

  const res = await dailyFetch("/rooms", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await parseDailyErrorBody(res);
    const message = errorMessageFromBody(errBody, `Daily create room failed (${res.status})`);
    throw new DailyApiError(message, res.status, errBody);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const name = data.name;
  const url = data.url;
  if (typeof name !== "string" || typeof url !== "string") {
    throw new DailyApiError("Daily create room response missing name or url", res.status, data);
  }

  return {
    name,
    url,
    ...(typeof data.id === "string" ? { id: data.id } : {}),
    ...(typeof data.created_at === "string" ? { created_at: data.created_at } : {}),
    ...(data.config !== undefined && typeof data.config === "object" && data.config !== null
      ? { config: data.config as Record<string, unknown> }
      : {}),
  };
}

export type CreateMeetingTokenOptions = {
  roomName: string;
  userName: string;
  /** Daily `user_id` (max 36 chars); use your app user id when it is a UUID. */
  userId: string;
  /** Lifetime in seconds from now (default 4 hours). */
  ttlSeconds?: number;
};

/**
 * Creates a meeting token for joining a private Daily room. Server-only.
 * https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token
 */
export async function createMeetingToken(
  options: CreateMeetingTokenOptions,
): Promise<string> {
  const ttl = options.ttlSeconds ?? 4 * 3600;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const roomName = options.roomName.trim();
  const userName = options.userName.trim().slice(0, 200) || "Participant";
  const userId = options.userId.trim().slice(0, 36);

  const res = await dailyFetch("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        user_id: userId,
        exp,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await parseDailyErrorBody(res);
    const message = errorMessageFromBody(errBody, `Daily meeting token failed (${res.status})`);
    throw new DailyApiError(message, res.status, errBody);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const token = data.token;
  if (typeof token !== "string" || !token.trim()) {
    throw new DailyApiError("Daily meeting token response missing token", res.status, data);
  }
  return token.trim();
}

export type DeleteDailyRoomOptions = {
  /**
   * When true (default), HTTP 404 is treated as success so teardown is idempotent
   * if the room was already deleted.
   */
  ignoreMissing?: boolean;
};

/**
 * Deletes a Daily room by name. Uses `DAILY_API_KEY` from the environment only.
 */
export async function deleteRoom(
  roomName: string,
  options: DeleteDailyRoomOptions = {},
): Promise<void> {
  const { ignoreMissing = true } = options;
  const trimmed = roomName.trim();
  if (!trimmed) {
    throw new Error("deleteRoom: room name is required");
  }

  const path = `/rooms/${encodeURIComponent(trimmed)}`;
  const res = await dailyFetch(path, { method: "DELETE" });

  if (!res.ok) {
    if (ignoreMissing && res.status === 404) {
      return;
    }
    const errBody = await parseDailyErrorBody(res);
    const message = errorMessageFromBody(errBody, `Daily delete room failed (${res.status})`);
    throw new DailyApiError(message, res.status, errBody);
  }
}
