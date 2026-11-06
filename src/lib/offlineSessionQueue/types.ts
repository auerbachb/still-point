import type { FocusCategory, SessionType, Track } from "@/lib/constants";

/** Thought captured during or after a sit, queued for offline sync (#558). */
export type PendingSessionThought = {
  timeInSession: number;
  text: string;
  /** #948: minted when the sit is queued and saved with it, so every upload of
   *  this thought — from any tab or the service worker — sends the same id and
   *  the server stores it once. Absent on the end note, which the server
   *  replaces, and on thoughts queued before #948, which upload as before. */
  clientThoughtId?: string;
};

/** One timestamped reading in a sit's mind-state or attention log. */
export type SessionStateLogEntry = { time: number; state: string };

/** POST /api/sessions body with the #557 client idempotency key attached.
 *
 *  #1122: the web client's only description of that body. Every sit, saved
 *  online or offline, is posted from the queue (its transport or `public/sw.js`), so a new
 *  session field is added here and read in `src/app/api/sessions/route.ts`.
 *  A new field's type is declared here once; `QueuedSessionRequest` and the
 *  queue helpers derive from this type rather than restating it. */
export type CreateSessionPayload = {
  /** The meditation day; for a `focus` session (#836), the `focusActivityDay`. */
  dayNumber: number;
  /** Includes `focus` (#765), so a focus session saved offline queues and syncs like a sit. */
  sessionType: SessionType;
  track?: Track;
  /** #769: today's two sits done as one. Present, as true, only on a combined
   *  sit; an entry queued without it (an older build) syncs as not combined. */
  combined?: boolean;
  duration: number;
  bonusSeconds?: number;
  completed: boolean;
  actualTime: number;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: SessionStateLogEntry[];
  attentionLog?: SessionStateLogEntry[] | null;
  sessionDate: string;
  breathCount?: number;
  /** #837: the category a focus session was for, kept so a queued one uploads
   *  with it. Absent (an entry queued before #837) or null saves no category. */
  focusCategory?: FocusCategory | null;
  clientSessionId: string;
};

/** A save request before the queue stamps its client id on it. */
export type QueuedSessionRequest = Omit<CreateSessionPayload, "clientSessionId">;

/** #978: the answer that turned a queued sit down for good. */
export type ParkedSession = {
  /** When it came back, as an ISO time. */
  at: string;
  /** Its HTTP status, or null for a failure that carried none. */
  status: number | null;
  /** Its text, cut to `PARKED_MESSAGE_MAX_LENGTH` characters. */
  message: string;
};

/** Durable local record of a completed sit awaiting server sync (#558). */
export type PendingSessionEntry = {
  clientSessionId: string;
  /** Account that enqueued this sit — prevents cross-user replay after logout/login. */
  ownerUserId: string;
  request: CreateSessionPayload;
  thoughts: PendingSessionThought[];
  serverSessionId: string | null;
  sessionSynced: boolean;
  enqueuedAt: string;
  /** #792: the stored completion note must be deleted on the next flush. Only
   *  set once the sit has a server row; entries written before this field
   *  existed omit it, which reads as false. */
  clearCompletionNote?: boolean;
  /** #978: set once the server answers this sit with a permanent 4xx other
   *  than 401 or 403. No flush sends a parked entry again, and it stays queued
   *  as the record of the sit. Entries queued before #978, and every entry
   *  never turned down, omit it. */
  parked?: ParkedSession;
};

export type SavedSessionResult = {
  sessionId: string;
  isPendingSync: boolean;
  serverSessionId: string | null;
};
