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
const txSelectChain = makeSelectChain();
const { select: dbSelect, from: selectFrom, where: selectWhere, limit: selectLimit } = dbSelectChain;
const { select: txSelect, limit: txSelectLimit } = txSelectChain;
const txInsertValues = vi.fn();
const txInsert = vi.fn(() => ({ values: txInsertValues }));
const txDeleteWhere = vi.fn();
const txDelete = vi.fn(() => ({ where: txDeleteWhere }));
const tx = {
  select: txSelect,
  insert: txInsert,
  delete: txDelete,
};
const transaction = vi.fn(async (callback) => callback(tx));

vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
  },
}));

vi.mock("@/db/pool", () => ({
  poolDb: {
    transaction,
  },
}));

vi.mock("@/db/schema", () => ({
  accountDeletionLog: {
    id: "deletionLogId",
    userId: "deletionLogUserId",
    emailHash: "emailHash",
  },
  users: {
    id: "userId",
    email: "email",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}));

describe("account deletion tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectLimit.mockResolvedValue([]);
    txSelectLimit.mockResolvedValue([]);
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

  test("records a deletion log before deleting the user", async () => {
    txSelectLimit.mockResolvedValue([{ id: "user-1", email: "Deleted@Example.com" }]);
    const { deleteUserAccount, getAccountDeletionEmailHash } = await import("./accountDeletion");

    await expect(deleteUserAccount("user-1")).resolves.toBe(true);

    expect(txInsert).toHaveBeenCalled();
    expect(txInsertValues).toHaveBeenCalledWith({
      userId: "user-1",
      emailHash: getAccountDeletionEmailHash("Deleted@Example.com"),
    });
    expect(txDelete).toHaveBeenCalled();
    expect(txDeleteWhere).toHaveBeenCalledWith({
      left: "userId",
      right: "user-1",
    });
    expect(txInsertValues.mock.invocationCallOrder[0]).toBeLessThan(
      txDeleteWhere.mock.invocationCallOrder[0],
    );
  });

  test("propagates deletion log write failures without deleting the user", async () => {
    const writeError = new Error("boom");
    txSelectLimit.mockResolvedValue([{ id: "user-1", email: "Deleted@Example.com" }]);
    txInsertValues.mockRejectedValueOnce(writeError);
    const { deleteUserAccount } = await import("./accountDeletion");

    await expect(deleteUserAccount("user-1")).rejects.toThrow(writeError);

    expect(txInsertValues).toHaveBeenCalled();
    expect(txDelete).not.toHaveBeenCalled();
  });

  test("does not log deletion when the user is already gone", async () => {
    const { deleteUserAccount } = await import("./accountDeletion");

    await expect(deleteUserAccount("missing-user")).resolves.toBe(false);

    expect(txInsert).not.toHaveBeenCalled();
    expect(txDelete).not.toHaveBeenCalled();
  });
});
