import type { Session } from "@/lib/api";
import type { CreateSessionPayload, PendingSessionThought } from "./types";

export type SessionSyncTransport = {
  createSession: (payload: CreateSessionPayload) => Promise<Session>;
  batchThoughts: (data: {
    sessionId: string;
    dayNumber: number;
    thoughts: PendingSessionThought[];
  }) => Promise<void>;
};

function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

export function liveSessionSyncTransport(): SessionSyncTransport {
  return {
    async createSession(payload) {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(text || `Create session failed (${res.status})`);
        if (res.status >= 500 || res.status === 408 || res.status === 429) {
          throw err;
        }
        throw Object.assign(err, { permanent: true });
      }
      const data = await res.json();
      return data.session as Session;
    },
    async batchThoughts(data) {
      const res = await fetch("/api/thoughts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(text || `Batch thoughts failed (${res.status})`);
        if (res.status >= 500 || res.status === 408 || res.status === 429) {
          throw err;
        }
        throw Object.assign(err, { permanent: true });
      }
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
