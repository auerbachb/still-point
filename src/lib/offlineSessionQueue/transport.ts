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
          const err = new Error(text || `Create session failed (${res.status})`);
          if (res.status >= 500 || res.status === 408 || res.status === 429) {
            throw Object.assign(err, { retryable: true });
          }
          throw Object.assign(err, { permanent: true });
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
          const err = new Error(text || `Batch thoughts failed (${res.status})`);
          if (res.status >= 500 || res.status === 408 || res.status === 429) {
            throw Object.assign(err, { retryable: true });
          }
          throw Object.assign(err, { permanent: true });
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

export { isNetworkFailure };
