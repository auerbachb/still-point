import type { SessionType, Track } from "@/lib/constants";

/** Thought captured during or after a sit, queued for offline sync (#558). */
export type PendingSessionThought = {
  timeInSession: number;
  text: string;
};

/** POST /api/sessions body with the #557 client idempotency key attached. */
export type CreateSessionPayload = {
  dayNumber: number;
  sessionType: SessionType;
  track?: Track;
  duration: number;
  bonusSeconds?: number;
  completed: boolean;
  actualTime: number;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: Array<{ time: number; state: string }>;
  attentionLog?: Array<{ time: number; state: string }> | null;
  sessionDate: string;
  breathCount?: number;
  clientSessionId: string;
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
};

export type SavedSessionResult = {
  sessionId: string;
  isPendingSync: boolean;
  serverSessionId: string | null;
};
