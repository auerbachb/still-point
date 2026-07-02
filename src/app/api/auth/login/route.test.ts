import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const selectLimit = vi.fn();
const selectWhere = vi.fn(() => ({ limit: selectLimit }));
const selectFrom = vi.fn(() => ({ where: selectWhere }));
const dbSelect = vi.fn(() => ({ from: selectFrom }));
const verifyPassword = vi.fn();
const createToken = vi.fn();
const setAuthCookie = vi.fn();
const wasAccountDeleted = vi.fn();
const DELETED_ACCOUNT_MESSAGE = "This account has been deleted. Create a new account to continue.";

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
  },
}));

vi.mock("@/db/schema", () => ({
  users: {
    email: "email",
    passwordHash: "passwordHash",
  },
}));

vi.mock("@/lib/auth", () => ({
  verifyPassword,
  createToken,
  setAuthCookie,
}));

vi.mock("@/lib/accountDeletion", () => ({
  wasAccountDeleted,
}));

vi.mock("@/lib/authErrors", () => ({
  DELETED_ACCOUNT_MESSAGE,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
    verifyPassword.mockResolvedValue(false);
    createToken.mockResolvedValue("token");
    wasAccountDeleted.mockResolvedValue(false);
  });

  test("keeps invalid credentials for unknown emails without a deletion log", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "missing@example.com", password: "password123" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({ error: "Invalid credentials" });
    expect(response.status).toBe(401);
    expect(wasAccountDeleted).toHaveBeenCalledWith("missing@example.com");
    expect(verifyPassword).toHaveBeenCalledWith("password123", expect.stringMatching(/^\$2b\$12\$/));
    expect(createToken).not.toHaveBeenCalled();
    expect(setAuthCookie).not.toHaveBeenCalled();
  });

  test("returns a deleted-account message when the deletion log matches", async () => {
    wasAccountDeleted.mockResolvedValue(true);
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "Deleted@Example.com ", password: "password123" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({
      error: DELETED_ACCOUNT_MESSAGE,
    });
    expect(response.status).toBe(410);
    expect(wasAccountDeleted).toHaveBeenCalledWith("deleted@example.com");
    expect(createToken).not.toHaveBeenCalled();
    expect(setAuthCookie).not.toHaveBeenCalled();
  });

  test("does not expose account existence when a password is wrong", async () => {
    selectLimit.mockResolvedValue([{ passwordHash: "hash" }]);
    verifyPassword.mockResolvedValue(false);
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", password: "bad-password" }),
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({ error: "Invalid credentials" });
    expect(response.status).toBe(401);
    expect(wasAccountDeleted).toHaveBeenCalledWith("user@example.com");
    expect(verifyPassword).toHaveBeenCalledWith("bad-password", "hash");
    expect(createToken).not.toHaveBeenCalled();
    expect(setAuthCookie).not.toHaveBeenCalled();
  });

  test("returns 400 for malformed JSON", async () => {
    const { POST } = await import("./route");

    const response = await POST(
      new Request("http://test.local/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"email":"user@example.com","password":"pw"',
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON body" });
    expect(response.status).toBe(400);
    expect(wasAccountDeleted).not.toHaveBeenCalled();
  });
});
