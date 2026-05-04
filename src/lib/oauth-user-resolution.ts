import { db } from "@/db";
import { users, oauthAccounts } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_REGEX,
} from "@/lib/username";
import { uniqueViolationConstraint } from "@/lib/dbErrors";

/** Sanitize a profile seed into a username candidate that satisfies
 *  users.username constraints (#136 + #8). */
function sanitizeUsernameSeed(seed: string): string {
  const cleaned = seed.replace(/[^A-Za-z0-9_]/g, "");
  if (cleaned.length === 0) return "user";
  return cleaned.slice(0, MAX_USERNAME_LENGTH);
}

function randomSuffix(length: number): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, length);
}

async function generateUniqueUsername(seed: string): Promise<string> {
  const base = sanitizeUsernameSeed(seed);
  const padded = base.length < MIN_USERNAME_LENGTH ? `${base}user`.slice(0, MAX_USERNAME_LENGTH) : base;

  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = attempt === 0 ? "" : `_${randomSuffix(4)}`;
    const candidate = `${padded.slice(0, MAX_USERNAME_LENGTH - suffix.length)}${suffix}`;

    if (!USERNAME_REGEX.test(candidate)) continue;
    if (candidate.length < MIN_USERNAME_LENGTH || candidate.length > MAX_USERNAME_LENGTH) continue;

    const [collision] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${candidate})`)
      .limit(1);
    if (!collision) return candidate;
  }

  return `user_${randomSuffix(10)}`;
}

/** Insert a (provider, providerAccountId) -> userId link, returning the
 *  userId that ends up owning the link. */
export async function linkProviderToUser(
  provider: string,
  providerAccountId: string,
  userId: string,
): Promise<string> {
  const inserted = await db
    .insert(oauthAccounts)
    .values({ userId, provider, providerAccountId })
    .onConflictDoNothing({
      target: [oauthAccounts.provider, oauthAccounts.providerAccountId],
    })
    .returning({ userId: oauthAccounts.userId });

  if (inserted.length > 0) return inserted[0].userId;

  const [existing] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("oauth_accounts insert returned no rows and no existing link");
  }
  return existing.userId;
}

const MAX_USERNAME_RETRIES = 5;

async function createUserWithUsernameRetry(email: string, seed: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_USERNAME_RETRIES; attempt++) {
    const username = await generateUniqueUsername(seed);
    try {
      const inserted = await db
        .insert(users)
        .values({ email, username })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });

      if (inserted.length > 0) return inserted[0].id;

      const [racedRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!racedRow) {
        throw new Error("users insert raced and lookup returned no row");
      }
      return racedRow.id;
    } catch (err) {
      const constraint = uniqueViolationConstraint(err);
      if (constraint === null) throw err;
      const isLikelyUsernameConstraint =
        constraint === "" || constraint.toLowerCase().includes("username");
      if (isLikelyUsernameConstraint && attempt < MAX_USERNAME_RETRIES) {
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to allocate a unique username after retries");
}

export type OAuthProfileInput = {
  name?: string | null;
};

/** Thrown when a new account / email-based link is needed but no verified email was supplied
 *  (e.g. native Apple repeat sign-in with identity token omitting `email`). */
export class OAuthEmailRequiredError extends Error {
  constructor() {
    super("Email is required to create or link a new account for this sign-in");
    this.name = "OAuthEmailRequiredError";
  }
}

/** Resolve or create the app user id for an OAuth provider identity.
 *  Lookup order: existing (provider, providerAccountId) link first;
 *  then email match for linking; else new user. `email` may be omitted only when
 *  an existing oauth_accounts row already exists for (provider, providerAccountId). */
export async function resolveOAuthUserId(params: {
  provider: string;
  providerAccountId: string;
  email?: string | null;
  profile: OAuthProfileInput;
}): Promise<string> {
  const { provider, providerAccountId, profile } = params;

  const [existingLink] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, provider),
        eq(oauthAccounts.providerAccountId, providerAccountId),
      ),
    )
    .limit(1);

  if (existingLink) {
    return existingLink.userId;
  }

  const rawEmail = params.email;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email) {
    throw new OAuthEmailRequiredError();
  }

  const [emailMatch] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let targetUserId: string;
  if (emailMatch) {
    targetUserId = emailMatch.id;
  } else {
    const seed =
      (typeof profile.name === "string" && profile.name) ||
      email.split("@")[0] ||
      "user";
    targetUserId = await createUserWithUsernameRetry(email, seed);
  }

  return linkProviderToUser(provider, providerAccountId, targetUserId);
}
