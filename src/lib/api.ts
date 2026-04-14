export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Request failed" }));
    const code = typeof data.code === "string" ? data.code : undefined;
    throw new ApiError(res.status, data.error || "Request failed", code);
  }
  return res.json();
}

export type User = {
  id: string;
  email: string;
  username: string;
  isPublic: boolean;
  currentDay: number;
};

export type Session = {
  id: string;
  dayNumber: number;
  duration: number;
  completed: boolean;
  actualTime: number | null;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: Array<{ time: number; state: string }> | null;
  sessionDate: string;
  /** Present when this row was created from a completed buddy sit (#119). */
  buddySessionId?: string | null;
};

export type Thought = {
  id: string;
  sessionId: string;
  dayNumber: number;
  timeInSession: number;
  text: string;
};

export type BoardEntry = {
  username: string;
  currentDay: number;
  streak: number;
  avgClear: number;
  totalSessions: number;
};

export type FriendPublicUser = {
  id: string;
  username: string;
};

export type FriendRequestRow = {
  id: string;
  createdAt: string;
  user: FriendPublicUser;
};

export type FriendRequestRecord = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type FriendRequestPatchResult = {
  request: {
    id: string;
    status: string;
    updatedAt: string;
    fromUserId?: string;
    toUserId?: string;
  };
};

export type BuddyParticipantSnap = {
  userId: string;
  username: string;
  isHost: boolean;
  ready: boolean;
  joinedAt: string;
  leftAt: string | null;
  connected: boolean;
  participantCompletedAt: string | null;
};

export type BuddySnapshot = {
  id: string;
  state: string;
  revision: number;
  durationSeconds: number;
  startedAt: string | null;
  serverNow: string;
  endsAt: string | null;
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
  /** Daily.co room URL while the shared sit is active; null if video is unavailable. */
  dailyRoomUrl: string | null;
  hostUserId: string;
  isHost: boolean;
  participants: BuddyParticipantSnap[];
};

export const api = {
  signup: (data: { email: string; username: string; password: string }) =>
    request<{ user: User }>("/api/auth/signup", { method: "POST", body: JSON.stringify(data) }),

  login: (data: { email: string; username: string; password: string }) =>
    request<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify(data) }),

  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),

  me: () =>
    request<{ user: User }>("/api/auth/me"),

  getSessions: () =>
    request<{ sessions: Session[]; stats: { streak: number; avgClearPercent: number; avgThoughtsPerSession: number; avgThoughtsPerMinute: number } }>("/api/sessions"),

  createSession: (data: {
    dayNumber: number;
    duration: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    sessionDate: string;
  }) =>
    request<{ session: Session }>("/api/sessions", { method: "POST", body: JSON.stringify(data) }),

  getSession: (dayNumber: number) =>
    request<{ session: Session; thoughts: Thought[] }>(`/api/sessions/${dayNumber}`),

  getThoughts: () =>
    request<{ thoughts: Thought[] }>("/api/thoughts"),

  batchThoughts: (data: {
    sessionId: string;
    dayNumber: number;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) =>
    request<{ thoughts: Thought[] }>("/api/thoughts/batch", { method: "POST", body: JSON.stringify(data) }),

  getBoard: () =>
    request<{ board: BoardEntry[] }>("/api/board"),

  updateSettings: (data: { isPublic?: boolean }) =>
    request<{ user: User }>("/api/settings", { method: "PATCH", body: JSON.stringify(data) }),

  getFriends: () => request<{ friends: FriendPublicUser[] }>("/api/friends"),

  searchFriends: (q: string) => {
    const t = q.trim();
    if (t.length < 2) {
      return Promise.resolve({ users: [] as FriendPublicUser[] });
    }
    return request<{ users: FriendPublicUser[] }>(`/api/friends/search?q=${encodeURIComponent(t)}`);
  },

  getFriendRequests: () =>
    request<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }>("/api/friends/requests"),

  sendFriendRequest: (toUserId: string) =>
    request<{ request: FriendRequestRecord }>("/api/friends/requests", {
      method: "POST",
      body: JSON.stringify({ toUserId }),
    }),

  updateFriendRequest: (id: string, action: "accept" | "reject" | "cancel") =>
    request<FriendRequestPatchResult>(`/api/friends/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),

  removeFriend: (friendUserId: string) =>
    request<{ ok: boolean }>(`/api/friends/${friendUserId}`, { method: "DELETE" }),

  createBuddySession: () =>
    request<{
      session: { id: string; shareToken: string; sharePath: string; durationSeconds: number };
    }>("/api/buddy/sessions", { method: "POST" }),

  joinBuddySession: (token: string) =>
    request<{ sessionId: string }>("/api/buddy/sessions/join", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  getBuddySnapshot: (sessionId: string) =>
    request<{ snapshot: BuddySnapshot }>(`/api/buddy/sessions/${sessionId}`),

  /** Server-issued Daily token for joining a private room while the buddy sit is active. */
  getBuddyMeetingToken: (sessionId: string) =>
    request<{ token: string }>(`/api/buddy/sessions/${sessionId}/meeting-token`, {
      method: "POST",
    }),

  setBuddyReady: (sessionId: string, ready: boolean) =>
    request<{ ok: boolean }>(`/api/buddy/sessions/${sessionId}/ready`, {
      method: "PATCH",
      body: JSON.stringify({ ready }),
    }),

  startBuddySession: (sessionId: string) =>
    request<{ ok: boolean; startedAt: string }>(
      `/api/buddy/sessions/${sessionId}/start`,
      { method: "POST" },
    ),

  leaveBuddySession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/buddy/sessions/${sessionId}/leave`, {
      method: "POST",
    }),

  cancelBuddySession: (sessionId: string) =>
    request<{ ok: boolean }>(`/api/buddy/sessions/${sessionId}/cancel`, {
      method: "POST",
    }),

  buddyParticipantComplete: (sessionId: string) =>
    request<{ ok: boolean; already?: boolean; participantCompletedAt?: string }>(
      `/api/buddy/sessions/${sessionId}/participant-complete`,
      { method: "POST" },
    ),

  /** #119: Create this user’s personal `sessions` row after the shared timer has finished (idempotent). */
  recordBuddyPersonalSession: (
    sessionId: string,
    body: {
      clearPercent: number;
      thoughtCount: number;
      mindStateLog: Array<{ time: number; state: string }>;
      actualTime: number;
      sessionDate: string;
      thoughts?: Array<{ timeInSession: number; text: string }>;
    },
  ) =>
    request<{ session: Session; already?: boolean }>(
      `/api/buddy/sessions/${sessionId}/record-personal-session`,
      { method: "POST", body: JSON.stringify(body) },
    ),
};
