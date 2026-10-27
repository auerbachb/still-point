import type { Session } from "@/lib/api";
import { UPLOAD_TIMEOUT_MS } from "./constants";
import type { CreateSessionPayload, PendingSessionThought } from "./types";

export type SessionSyncTransport = {
  createSession: (payload: CreateSessionPayload) => Promise<Session>;
  batchThoughts: (data: {
    sessionId: string;
    dayNumber: number;
    thoughts: PendingSessionThought[];
    /** #792: present (and true) only when the queued entry asks for a clear. */
    clearCompletionNote?: true;
  }) => Promise<void>;
};

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return Boolean(error && typeof error === "object" && "retryable" in error && (error as { retryable?: boolean }).retryable);
}

/** A 4xx other than 408 and 429: sent again, the upload gets the same answer. */
function isPermanentFailure(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "permanent" in error);
}

/** #978: the HTTP status a failed upload was answered with, or null when it got none. */
function failureStatus(error: unknown): number | null {
  const status = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" ? status : null;
}

/**
 * The error a non-2xx answer throws. A 5xx, 408 or 429 is worth retrying; any
 * other status is the same answer every time. #978: the status goes with it,
 * so a flush can tell a lapsed sign-in from an answer about the sit itself.
 * `public/sw.js` classifies its own uploads the same way.
 */
function uploadFailure(status: number, message: string): Error {
  const err = new Error(message);
  if (status >= 500 || status === 408 || status === 429) {
    return Object.assign(err, { status, retryable: true });
  }
  return Object.assign(err, { status, permanent: true });
}

/** How `fetch` and body reads reject once their signal aborts. */
function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError");
}

/**
 * #907: runs one upload, aborting it after `UPLOAD_TIMEOUT_MS`. Every upload
 * holds the queue lock that all tabs and the service worker share (#834), so
 * one that never settled (a half-open connection, a stalled radio) would keep
 * every other queue write waiting. The deadline covers the body read too: a
 * response can stall after its headers.
 *
 * An aborted upload throws as retryable, so `flushEntry` keeps the entry queued
 * for the next flush and the lock is freed.
 */
async function withUploadDeadline<T>(upload: (signal: AbortSignal) => Promise<T>): Promise<T> {
  // A controller and timer rather than `AbortSignal.timeout`, which is missing
  // before iOS 16 (the pattern `web-push-client.ts` uses too).
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    return await upload(controller.signal);
  } catch (error) {
    // A failure already classified by its status is not an AbortError, so it
    // keeps its class even when the deadline cut its error body short.
    if (controller.signal.aborted && isAbortError(error)) {
      throw Object.assign(new Error("Upload timed out", { cause: error }), { retryable: true });
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

export function liveSessionSyncTransport(): SessionSyncTransport {
  return {
    async createSession(payload) {
      return withUploadDeadline(async (signal) => {
        const res = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
          signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw uploadFailure(res.status, text || `Create session failed (${res.status})`);
        }
        const data = await res.json();
        return data.session as Session;
      });
    },
    async batchThoughts(data) {
      return withUploadDeadline(async (signal) => {
        const res = await fetch("/api/thoughts/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(data),
          signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw uploadFailure(res.status, text || `Batch thoughts failed (${res.status})`);
        }
      });
    },
  };
}

export const alwaysFailingSessionSyncTransport: SessionSyncTransport = {
  createSession: async () => {
    throw new TypeError("Network unavailable");
  },
  batchThoughts: async () => {
    throw new TypeError("Network unavailable");
  },
};

export { failureStatus, isNetworkFailure, isPermanentFailure };
