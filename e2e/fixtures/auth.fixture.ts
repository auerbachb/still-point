import { test as base, expect, type Page, type Route } from "@playwright/test";
import { tap } from "../utils/mobile-helpers";

type UserRecord = {
  id: string;
  email: string;
  username: string;
  isPublic: boolean;
  currentDay: number;
};

type SessionRecord = {
  id: string;
  dayNumber: number;
  sessionType: "standard" | "quick";
  duration: number;
  bonusSeconds: number;
  completed: boolean;
  actualTime: number;
  clearPercent: number;
  thoughtCount: number;
  mindStateLog: Array<{ time: number; state: string }>;
  sessionDate: string;
};

type ThoughtRecord = {
  id: string;
  sessionId: string;
  dayNumber: number;
  timeInSession: number;
  text: string;
};

type AuthedContext = {
  email: string;
  username: string;
  password: string;
};

type MockApiState = {
  authenticated: boolean;
  user: UserRecord;
  credentials: AuthedContext;
  resetToken: string | null;
  sessions: SessionRecord[];
  thoughts: ThoughtRecord[];
  ids: { session: number; thought: number };
};

type AuthFixture = {
  ensureLoggedIn: () => Promise<AuthedContext>;
  seedHistorySessions: (count: number) => Promise<void>;
  mockApiState: MockApiState;
};

function uniqueIdentity(): AuthedContext {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    email: `mobile-${suffix}@stillpoint.test`,
    username: `mobile_${suffix.replace(/[^a-z0-9]/gi, "")}`,
    password: "password123",
  };
}

function getLocalIsoDate(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computeStats(sessions: SessionRecord[]) {
  const standardSessions = sessions.filter((s) => s.sessionType === "standard");
  const completedSessions = standardSessions.filter((s) => s.completed);
  const totalSessions = standardSessions.length;
  let streak = 0;
  const completedByDay = new Map<number, boolean>();
  for (const session of standardSessions) {
    completedByDay.set(
      session.dayNumber,
      (completedByDay.get(session.dayNumber) ?? false) || session.completed,
    );
  }
  const maxDay = Math.max(0, ...completedByDay.keys());
  for (let day = maxDay; day >= 1; day -= 1) {
    if (completedByDay.get(day) === true) {
      streak += 1;
    } else {
      break;
    }
  }

  const avgClearPercent = completedSessions.length
    ? Math.round(completedSessions.reduce((sum, s) => sum + s.clearPercent, 0) / completedSessions.length)
    : 0;
  const avgThoughtsPerSession = totalSessions
    ? Number((standardSessions.reduce((sum, s) => sum + s.thoughtCount, 0) / totalSessions).toFixed(1))
    : 0;
  const avgThoughtsPerMinute = totalSessions
    ? Number(
        (
          standardSessions.reduce((sum, s) => {
            const bonus = s.bonusSeconds ?? 0;
            const minutes = (s.duration + bonus) / 60;
            return sum + (minutes > 0 ? s.thoughtCount / minutes : 0);
          }, 0) / totalSessions
        ).toFixed(1),
      )
    : 0;
  const bonusSecondsTotal = standardSessions.reduce((sum, s) => sum + (s.bonusSeconds ?? 0), 0);
  const bonusMinutesTotal = Math.round(bonusSecondsTotal / 60);
  return { streak, avgClearPercent, avgThoughtsPerSession, avgThoughtsPerMinute, bonusMinutesTotal };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installMockApiRoutes(page: Page, state: MockApiState) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;

    if (pathname === "/api/auth/me" && method === "GET") {
      if (!state.authenticated) return json(route, 401, { error: "Unauthorized" });
      return json(route, 200, { user: state.user });
    }

    if (pathname === "/api/auth/signup" && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Partial<AuthedContext>;
      const email = String(body.email ?? "").trim().toLowerCase();
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (!email || !username || !password) {
        return json(route, 400, { error: "All fields required" });
      }
      state.credentials = { email, username, password };
      state.user = {
        id: `user-${Date.now()}`,
        email,
        username,
        isPublic: false,
        currentDay: 1,
      };
      state.authenticated = true;
      return json(route, 200, { user: state.user });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Partial<AuthedContext>;
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      if (email !== state.credentials.email || password !== state.credentials.password) {
        return json(route, 401, { error: "Invalid credentials" });
      }
      state.authenticated = true;
      return json(route, 200, { user: state.user });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
      state.authenticated = false;
      return json(route, 200, { ok: true });
    }

    if (pathname === "/api/auth/password-reset/request" && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Partial<AuthedContext>;
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        return json(route, 400, { error: "A valid email is required" });
      }
      if (email === state.credentials.email) {
        state.resetToken = `reset-${Date.now()}`;
      }
      return json(route, 200, {
        message: "If an account exists for that email, a reset link will arrive shortly.",
      });
    }

    if (pathname === "/api/auth/password-reset/confirm" && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as { token?: string; password?: string } | undefined;
      if (!body?.token || String(body?.password ?? "").length < 8) {
        return json(route, 400, { error: "Valid token and password of at least 8 characters required" });
      }
      if (!state.resetToken || body.token !== state.resetToken) {
        return json(route, 400, { error: "Reset link is invalid or expired" });
      }
      state.credentials = { ...state.credentials, password: String(body.password) };
      state.resetToken = null;
      return json(route, 200, { ok: true });
    }

    if (pathname === "/api/sessions" && method === "GET") {
      if (!state.authenticated) return json(route, 401, { error: "Unauthorized" });
      const sessions = [...state.sessions].sort((a, b) => b.dayNumber - a.dayNumber);
      return json(route, 200, { sessions, stats: computeStats(sessions) });
    }

    if (pathname === "/api/sessions" && method === "POST") {
      if (!state.authenticated) return json(route, 401, { error: "Unauthorized" });
      const body = (request.postDataJSON() ?? {}) as Partial<SessionRecord>;
      const session: SessionRecord = {
        id: `session-${state.ids.session++}`,
        dayNumber: Number(body.dayNumber ?? state.user.currentDay),
        sessionType: body.sessionType === "quick" ? "quick" : "standard",
        duration: Number(body.duration ?? 60),
        bonusSeconds:
          typeof body.bonusSeconds === "number" && Number.isFinite(body.bonusSeconds)
            ? Math.max(0, Math.floor(body.bonusSeconds))
            : 0,
        completed: Boolean(body.completed ?? true),
        actualTime: Number(body.actualTime ?? body.duration ?? 60),
        clearPercent: Number(body.clearPercent ?? 100),
        thoughtCount: Number(body.thoughtCount ?? 0),
        mindStateLog: Array.isArray(body.mindStateLog) ? body.mindStateLog : [],
        sessionDate: String(body.sessionDate ?? getLocalIsoDate()),
      };
      state.sessions.push(session);
      if (session.completed && session.sessionType === "standard") state.user.currentDay += 1;
      return json(route, 200, { session });
    }

    if (pathname === "/api/thoughts" && method === "GET") {
      if (!state.authenticated) return json(route, 401, { error: "Unauthorized" });
      const thoughts = [...state.thoughts].sort((a, b) => {
        if (a.dayNumber !== b.dayNumber) {
          return b.dayNumber - a.dayNumber;
        }
        return a.timeInSession - b.timeInSession;
      });
      return json(route, 200, { thoughts });
    }

    if (pathname === "/api/thoughts/batch" && method === "POST") {
      if (!state.authenticated) return json(route, 401, { error: "Unauthorized" });
      const body = request.postDataJSON() as
        | { sessionId?: string; dayNumber?: number; thoughts?: Array<{ timeInSession: number; text: string }> }
        | undefined;
      const sessionId = body?.sessionId ?? `session-${Math.max(state.ids.session - 1, 1)}`;
      const dayNumber = Number(body?.dayNumber ?? state.user.currentDay);
      const created = (body?.thoughts ?? []).map((thought) => ({
        id: `thought-${state.ids.thought++}`,
        sessionId,
        dayNumber,
        timeInSession: Number(thought.timeInSession),
        text: thought.text,
      }));
      state.thoughts.push(...created);
      return json(route, 200, { thoughts: created });
    }

    return json(route, 404, { error: `No mock for ${method} ${pathname}` });
  });
}

export const test = base.extend<AuthFixture>({
  mockApiState: async ({ page }, use) => {
    const credentials = uniqueIdentity();
    const state: MockApiState = {
      authenticated: false,
      credentials,
      user: {
        id: `user-${Date.now()}`,
        email: credentials.email,
        username: credentials.username,
        isPublic: false,
        currentDay: 1,
      },
      resetToken: null,
      sessions: [],
      thoughts: [],
      ids: { session: 1, thought: 1 },
    };

    await installMockApiRoutes(page, state);
    await use(state);
  },

  ensureLoggedIn: async ({ page, mockApiState }, use) => {
    await use(async () => {
      if (mockApiState.authenticated) {
        await page.goto("/app");
        await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
        return mockApiState.credentials;
      }

      await page.goto("/app");
      await tap(page.getByRole("button", { name: "sign up" }));
      await page.getByPlaceholder("email").fill(mockApiState.credentials.email);
      await page.getByPlaceholder("username").fill(mockApiState.credentials.username);
      await page.getByPlaceholder("password").fill(mockApiState.credentials.password);
      await tap(page.getByRole("button", { name: "Begin the journey" }));
      await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
      return mockApiState.credentials;
    });
  },

  seedHistorySessions: async ({ mockApiState }, use) => {
    await use(async (count: number) => {
      mockApiState.sessions = [];
      mockApiState.thoughts = [];
      mockApiState.ids = { session: 1, thought: 1 };
      for (let day = 1; day <= count; day += 1) {
        const session: SessionRecord = {
          id: `session-${mockApiState.ids.session++}`,
          dayNumber: day,
          sessionType: "standard",
          duration: 60 + (day - 1) * 10,
          bonusSeconds: 0,
          completed: true,
          actualTime: 60 + (day - 1) * 10,
          clearPercent: Math.max(55, 90 - (day % 9) * 3),
          thoughtCount: day % 3,
          mindStateLog: [],
          sessionDate: getLocalIsoDate(-(count - day)),
        };
        mockApiState.sessions.push(session);
        for (let i = 0; i < session.thoughtCount; i += 1) {
          mockApiState.thoughts.push({
            id: `thought-${mockApiState.ids.thought++}`,
            sessionId: session.id,
            dayNumber: session.dayNumber,
            timeInSession: 10 * (i + 1),
            text: `seed thought ${day}-${i + 1}`,
          });
        }
      }
      mockApiState.user.currentDay = count + 1;
    });
  },
});

export { expect };
