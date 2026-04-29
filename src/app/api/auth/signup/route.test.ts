import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));

const insertReturning = vi.fn();
const insertValues = vi.fn(() => ({ returning: insertReturning }));
const dbInsert = vi.fn(() => ({ values: insertValues }));

const hashPassword = vi.fn();
const createToken = vi.fn();
const setAuthCookie = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
    insert: dbInsert,
  },
}));

vi.mock("@/db/schema", () => ({
  users: {
    email: "email",
    username: "username",
  },
}));

vi.mock("@/lib/auth", () => ({
  hashPassword,
  createToken,
  setAuthCookie,
}));

vi.mock("@/lib/dbErrors", () => ({
  uniqueViolationConstraint: (e: unknown): string | null => {
    if (!e || typeof e !== "object") return null;
    const o = e as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown };
    if (o.code === "23505") return o.constraint ?? o.constraint_name ?? "";
    if (o.cause) return null;
    return null;
  },
}));

vi.mock("@/lib/username", () => ({
  USERNAME_ERROR: "Username must be 3-30 characters (letters, numbers, underscores)",
  isValidUsername: (u: unknown): boolean =>
    typeof u === "string" && u.length >= 3 && u.length <= 30 && /^[a-zA-Z0-9_]+$/.test(u),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ kind: "eq", left, right })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ kind: "sql", strings, values }),
    {},
  ),
}));

function makeRequest(body: Record<string, unknown>, headers?: Record<string, string>): NextRequest {
  return new Request("http://test.local/api/auth/signup", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("POST /api/auth/signup uniqueness handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
    hashPassword.mockResolvedValue("hashed");
    createToken.mockResolvedValue("token");
    insertReturning.mockResolvedValue([
      { id: "u1", email: "alice@example.com", username: "alice", isPublic: false, currentDay: 1 },
    ]);
  });

  test("rejects duplicate email at the pre-check (case-normalized)", async () => {
    selectLimit.mockResolvedValueOnce([{ id: "u-existing" }]);
    const { POST } = await import("./route");

    const response = await POST(
      makeRequest({ email: "Alice@Example.com", username: "alice", password: "password123" }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Email already in use" });
    expect(response.status).toBe(409);
    expect(dbInsert).not.toHaveBeenCalled();
  });

  test("rejects duplicate username at the pre-check (case-insensitive)", async () => {
    selectLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "u-existing" }]);
    const { POST } = await import("./route");

    const response = await POST(
      makeRequest({ email: "new@example.com", username: "Alice", password: "password123" }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Username already taken" });
    expect(response.status).toBe(409);
    expect(dbInsert).not.toHaveBeenCalled();
    // Pin the predicate shape so a regression to plain eq(users.username, ...)
    // (which would be case-sensitive) fails this test instead of silently passing.
    expect(selectWhere).toHaveBeenCalledTimes(2);
    const usernamePredicate = selectWhere.mock.calls[1][0] as { kind?: string };
    expect(usernamePredicate?.kind).toBe("sql");
  });

  test("maps Postgres 23505 on email constraint to 'Email already in use' (race fallback)", async () => {
    insertReturning.mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: "23505", constraint: "users_email_unique" }),
    );
    const { POST } = await import("./route");

    const response = await POST(
      makeRequest({ email: "alice@example.com", username: "alice", password: "password123" }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Email already in use" });
    expect(response.status).toBe(409);
    expect(setAuthCookie).not.toHaveBeenCalled();
  });

  test("maps Postgres 23505 on username constraint to 'Username already taken' (race fallback)", async () => {
    insertReturning.mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: "23505", constraint: "users_username_lower_unique" }),
    );
    const { POST } = await import("./route");

    const response = await POST(
      makeRequest({ email: "alice@example.com", username: "alice", password: "password123" }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Username already taken" });
    expect(response.status).toBe(409);
  });

  test("falls back to a generic 409 when the unique-violation constraint is unrecognized", async () => {
    insertReturning.mockRejectedValueOnce(
      Object.assign(new Error("dup"), { code: "23505", constraint: "" }),
    );
    const { POST } = await import("./route");

    const response = await POST(
      makeRequest({ email: "alice@example.com", username: "alice", password: "password123" }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Email or username already in use" });
    expect(response.status).toBe(409);
  });

  test("non-23505 errors still surface as 500 (no false uniqueness signal)", async () => {
    insertReturning.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "08006" }));
    const { POST } = await import("./route");

    const response = await POST(
      makeRequest({ email: "alice@example.com", username: "alice", password: "password123" }),
    );

    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
    expect(response.status).toBe(500);
  });
});
