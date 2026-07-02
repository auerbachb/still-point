import { createHash } from "crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";

function makeSelectChain() {
  const limit = vi.fn();
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select, from, where, limit };
}

const dbSelectChain = makeSelectChain();
const { select: dbSelect, from: selectFrom, where: selectWhere, limit: selectLimit } = dbSelectChain;
const atomicDeleteUserAccount = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
  },
}));

vi.mock("@/db/atomic", () => ({
  atomicDeleteUserAccount,
}));

vi.mock("@/db/schema", () => ({
  accountDeletionLog: {
    id: "deletionLogId",
    userId: "deletionLogUserId",
    emailHash: "emailHash",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("account deletion tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
    atomicDeleteUserAccount.mockResolvedValue(true);
  });

  test("hashes normalized emails for deletion lookups", async () => {
    const { getAccountDeletionEmailHash } = await import("./accountDeletion");
    const expected = createHash("sha256").update("deleted@example.com").digest("hex");

    expect(getAccountDeletionEmailHash(" Deleted@Example.com ")).toBe(expected);
  });

  test("finds deletion log entries by normalized email hash", async () => {
    selectLimit.mockResolvedValue([{ id: "entry-1" }]);
    const { wasAccountDeleted, getAccountDeletionEmailHash } = await import("./accountDeletion");

    await expect(wasAccountDeleted(" Deleted@Example.com ")).resolves.toBe(true);
    expect(selectFrom).toHaveBeenCalledWith(
      expect.objectContaining({ emailHash: "emailHash" }),
    );
    expect(selectWhere).toHaveBeenCalledWith({
      left: "emailHash",
      right: getAccountDeletionEmailHash("Deleted@Example.com"),
    });
    expect(selectLimit).toHaveBeenCalledWith(1);
  });

  test("delegates deletion to the atomic helper", async () => {
    const { deleteUserAccount } = await import("./accountDeletion");

    await expect(deleteUserAccount("user-1")).resolves.toBe(true);

    expect(atomicDeleteUserAccount).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("propagates atomic deletion failures", async () => {
    const writeError = new Error("boom");
    atomicDeleteUserAccount.mockRejectedValueOnce(writeError);
    const { deleteUserAccount } = await import("./accountDeletion");

    await expect(deleteUserAccount("user-1")).rejects.toThrow(writeError);
    expect(atomicDeleteUserAccount).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("returns false when the atomic helper finds no user", async () => {
    atomicDeleteUserAccount.mockResolvedValueOnce(false);
    const { deleteUserAccount } = await import("./accountDeletion");

    await expect(deleteUserAccount("missing-user")).resolves.toBe(false);
    expect(atomicDeleteUserAccount).toHaveBeenCalledWith({ userId: "missing-user" });
  });
});
