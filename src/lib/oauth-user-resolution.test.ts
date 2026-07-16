import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { oauthAccounts, users } from "@/db/schema";
import { closeTestDb, getTestDb, type TestDb } from "@/lib/testing/pgliteTestDb";

vi.mock("@/db", async () => ({ db: await getTestDb() }));

import {
  OAuthEmailRequiredError,
  resolveOAuthUserId,
} from "./oauth-user-resolution";

let db: TestDb;
let seq = 0;

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  db = await getTestDb();
});

describe("resolveOAuthUserId (#539)", () => {
  test("returns an existing provider link without requiring email", async () => {
    seq += 1;
    const [user] = await db
      .insert(users)
      .values({ email: `oauth539-${seq}@test.local`, username: `oauth539_${seq}` })
      .returning();
    await db.insert(oauthAccounts).values({
      userId: user!.id,
      provider: "apple",
      providerAccountId: `apple-sub-${seq}`,
    });

    const userId = await resolveOAuthUserId({
      provider: "apple",
      providerAccountId: `apple-sub-${seq}`,
      profile: {},
    });

    expect(userId).toBe(user!.id);
  });

  test("links a new provider identity to an existing email match", async () => {
    seq += 1;
    const [user] = await db
      .insert(users)
      .values({ email: `oauth539-link-${seq}@test.local`, username: `oauth539l_${seq}` })
      .returning();

    const userId = await resolveOAuthUserId({
      provider: "google",
      providerAccountId: `google-sub-${seq}`,
      email: `oauth539-link-${seq}@test.local`,
      profile: { name: "OAuth Tester" },
    });

    expect(userId).toBe(user!.id);

    const [link] = await db
      .select()
      .from(oauthAccounts)
      .where(eq(oauthAccounts.providerAccountId, `google-sub-${seq}`));
    expect(link!.userId).toBe(user!.id);
  });

  test("creates a new user when email is unseen and sanitizes the username seed", async () => {
    seq += 1;
    const email = `oauth539-new-${seq}@test.local`;

    const userId = await resolveOAuthUserId({
      provider: "google",
      providerAccountId: `google-new-${seq}`,
      email,
      profile: { name: "!!!" },
    });

    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user!.email).toBe(email);
    expect(user!.username.length).toBeGreaterThanOrEqual(3);
  });

  test("throws OAuthEmailRequiredError when email is missing for a new link", async () => {
    await expect(
      resolveOAuthUserId({
        provider: "apple",
        providerAccountId: "brand-new-sub",
        profile: {},
      }),
    ).rejects.toBeInstanceOf(OAuthEmailRequiredError);
  });
});
