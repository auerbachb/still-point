export class ApiError extends Error {
  constructor(public status: number, message: string) {
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
    throw new ApiError(res.status, data.error || "Request failed");
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
};

export type Thought = {
  id: string;
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
};
