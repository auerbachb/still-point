/**
 * Pure helpers over queued entries: no store, no transport, no locks. The
 * coordinator owns every read, write and upload; these only shape the data.
 */
import { PARKED_MESSAGE_MAX_LENGTH } from "./constants";
import { failureStatus, isNetworkFailure, isPermanentFailure } from "./transport";
import type {
  CreateSessionPayload,
  ParkedSession,
  PendingSessionEntry,
  PendingSessionThought,
  SavedSessionResult,
} from "./types";

export function requestWithClientId(
  request: Omit<CreateSessionPayload, "clientSessionId">,
  clientSessionId: string,
): CreateSessionPayload {
  return { ...request, clientSessionId };
}

export function provisionalSessionId(clientSessionId: string): string {
  return clientSessionId;
}

/** The entry still owes the server something: its session row, queued
 *  thoughts, or a completion-note clear (#792). */
export function awaitsSync(entry: PendingSessionEntry): boolean {
  return !entry.sessionSynced || entry.thoughts.length > 0 || entry.clearCompletionNote === true;
}

/** #948: an id for each in-session thought, given before the entry is first
 *  saved, so every upload of it sends the same one. A batch the server stored
 *  but whose response was lost (`UPLOAD_TIMEOUT_MS`, a dropped connection) is
 *  then not stored twice when it is sent again. The end note gets none: the
 *  server replaces it instead. */
export function withClientThoughtIds(thoughts: PendingSessionThought[]): PendingSessionThought[] {
  return thoughts.map((thought) =>
    thought.timeInSession === -1 || thought.clientThoughtId
      ? thought
      : { ...thought, clientThoughtId: crypto.randomUUID() },
  );
}

/** #948: whether a thought the batch sent is this queued one. A thought with an
 *  id is matched by it. One queued before ids existed, and the end note, are
 *  matched by time and text, as before. */
export function isSameThought(sent: PendingSessionThought, queued: PendingSessionThought): boolean {
  if (sent.clientThoughtId || queued.clientThoughtId) {
    return sent.clientThoughtId === queued.clientThoughtId;
  }
  return sent.timeInSession === queued.timeInSession && sent.text === queued.text;
}

/** The queued thoughts a batch did not carry. */
export function thoughtsNotSent(
  queued: PendingSessionThought[],
  sent: PendingSessionThought[],
): PendingSessionThought[] {
  return queued.filter((thought) => !sent.some((item) => isSameThought(item, thought)));
}

/** Index of this account's entry for the sit, or -1. */
export function findOwnedEntryIndex(
  entries: PendingSessionEntry[],
  clientSessionId: string,
  ownerUserId: string,
): number {
  return entries.findIndex(
    (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
  );
}

/** This account's entry for the sit, if queued. */
export function findOwnedEntry(
  entries: PendingSessionEntry[],
  clientSessionId: string,
  ownerUserId: string,
): PendingSessionEntry | undefined {
  return entries.find(
    (item) => item.clientSessionId === clientSessionId && item.ownerUserId === ownerUserId,
  );
}

/** A new entry for a sit not yet queued. */
export function newPendingEntry(
  request: Omit<CreateSessionPayload, "clientSessionId">,
  clientSessionId: string,
  ownerUserId: string,
  thoughts: PendingSessionThought[],
): PendingSessionEntry {
  return {
    clientSessionId,
    ownerUserId,
    request: requestWithClientId(request, clientSessionId),
    thoughts: withClientThoughtIds(thoughts),
    serverSessionId: null,
    sessionSynced: false,
    enqueuedAt: new Date().toISOString(),
  };
}

/** Sets (or, with `note` null, clears) the entry's end note in place. The queue
 *  keeps at most one end note and never touches the in-session thoughts. */
export function applyEndNote(entry: PendingSessionEntry, note: string | null): void {
  // #753: autosave can run again as the note is edited. Keep one end note
  // and replace its text. A second -1 in the same batch is rejected.
  const kept = entry.thoughts.filter((thought) => thought.timeInSession !== -1);
  if (note !== null) kept.push({ timeInSession: -1, text: note });
  entry.thoughts = kept;
  // #792: a new note replaces the stored one server-side, so only a clear
  // needs the flag — and only once the sit has a server row that could hold
  // a note. Before that, dropping the queued note is the whole clear.
  entry.clearCompletionNote = note === null && entry.sessionSynced;
}

export function syncedResult(serverSessionId: string): SavedSessionResult {
  return { sessionId: serverSessionId, isPendingSync: false, serverSessionId };
}

export function pendingResult(clientSessionId: string): SavedSessionResult {
  return {
    sessionId: provisionalSessionId(clientSessionId),
    isPendingSync: true,
    serverSessionId: null,
  };
}

/** An upload failure that keeps the entry queued: a network failure, or any
 *  error not marked permanent. A permanent one is the same answer every time. */
export function keepsEntryQueued(error: unknown): boolean {
  return isNetworkFailure(error) || !isPermanentFailure(error);
}

/** #978: the server turned this sit down for good, so no flush sends it again. */
export function isParked(entry: PendingSessionEntry): boolean {
  return Boolean(entry.parked);
}

/**
 * #978: whether a permanent answer is about the sit itself. A 401 means the
 * sign-in lapsed, and neither route answers 403, so one comes from in front of
 * them. A later flush can get past both, so those entries stay queued. Any
 * other permanent answer (a validation 400, the 404 for a session that is gone,
 * …) would be the same every time.
 */
export function rejectsTheSit(error: unknown): boolean {
  const status = failureStatus(error);
  return status !== 401 && status !== 403;
}

/** #978: what a parked entry keeps of the answer that parked it. */
export function parkedBy(error: unknown): ParkedSession {
  const message = error instanceof Error ? error.message : String(error);
  return {
    at: new Date().toISOString(),
    status: failureStatus(error),
    message: message.slice(0, PARKED_MESSAGE_MAX_LENGTH),
  };
}
