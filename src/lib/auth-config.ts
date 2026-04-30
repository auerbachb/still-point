import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db";
import { users, oauthAccounts } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  USERNAME_REGEX,
} from "@/lib/username";
import { uniqueViolationConstraint } from "@/lib/dbErrors";

/** Sanitize a Google profile field into a username candidate that satisfies
 *  the existing users.username constraints (#136 + #8 case-insensitive
 *  uniqueness). The function may still return a colliding name; the
 *  surrounding loop appends random suffixes until a free slot is found. */
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

  // Last resort: 10-char random suffix. Crypto-RNG keeps the probability of
  // collision negligible even under contention.
  return `user_${randomSuffix(10)}`;
}

/** Insert a (provider, providerAccountId) -> userId link, returning the
 *  userId that ends up owning the link. If a link already exists (race or
 *  re-sign-in), the existing row's userId wins via ON CONFLICT DO NOTHING +
 *  fallback lookup. This guarantees the link/userId mapping is unique. */
async function linkProviderToUser(
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

  // Race: another callback inserted the same link. Use whichever userId
  // ended up owning it. (Cannot be `userId` we passed in if we lost the
  // race for an already-linked-to-different-user row.)
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

/** Insert a new user, retrying with a fresh username if the
 *  case-insensitive username unique index races. The pre-check in
 *  `generateUniqueUsername()` reduces but does not eliminate the race —
 *  two concurrent first-time OAuth sign-ins with the same name seed could
 *  both pre-check, both pick the same candidate, and both attempt the
 *  same insert. The first wins; the loser regenerates and retries.
 *
 *  Email conflicts collapse via ON CONFLICT DO NOTHING (we re-look-up the
 *  row a sibling callback inserted). Username conflicts cannot be handled
 *  with a single ON CONFLICT clause alongside email, so they're caught as
 *  a Postgres unique_violation and re-attempted with a new candidate. */
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

      // Email conflict — another callback created this user. Look up.
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
      // uniqueViolationConstraint returns:
      //   - null  → not a unique_violation, do not retry
      //   - ""    → unique_violation but driver did not surface the
      //             constraint name (Neon HTTP can do this)
      //   - "..." → constraint name string
      // The email conflict path is handled by onConflictDoNothing above
      // (no throw), so any unique_violation that reaches here must be on
      // the username index. Treat empty/unknown names as retryable too,
      // otherwise an empty-string constraint silently falls through and
      // the truthy check on `constraint &&` would skip the retry.
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

declare module "next-auth" {
  interface Session {
    userId?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  // Only override `error`. Setting `pages.signIn` to a custom path tells
  // Auth.js v5 that we render our own signin UI on that path, which
  // changes the routing — the built-in `/api/auth/signin/<provider>`
  // route then expects to be reached only via POST+CSRF from that page.
  // We don't need a custom signin page: AuthScreen renders at /app
  // whenever sp_token is missing, completely outside Auth.js's flow. The
  // `signIn()` helper in AuthScreen handles POST+CSRF automatically.
  pages: {
    error: "/app",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !profile) return false;
      const rawEmail = typeof profile.email === "string" ? profile.email : null;
      // Default to false when email_verified is absent: an unknown
      // verification state must NOT be treated as verified. Google always
      // sets email_verified for OIDC userinfo, so the only path that hits
      // the false default is a provider that doesn't surface the claim —
      // which we should reject rather than implicitly trust.
      const emailVerified =
        (profile as { email_verified?: boolean }).email_verified ?? false;
      if (!rawEmail || !emailVerified) return false;

      const email = rawEmail.trim().toLowerCase();
      const provider = account.provider;
      const providerAccountId = account.providerAccountId;
      if (!provider || !providerAccountId) return false;

      // Resolve provider identity FIRST: if (provider, providerAccountId)
      // is already linked to a user, that's the owner — full stop. Email
      // matching is only used to attach a *new* provider identity to an
      // existing email-only account; we must never let an email match
      // hijack a provider identity that already belongs to a different
      // user (account-takeover guard).
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

      let userId: string;

      if (existingLink) {
        userId = existingLink.userId;
      } else {
        // No link yet → resolve target user (existing email match or
        // freshly created), then link the provider identity to them
        // atomically. ON CONFLICT collapses concurrent callbacks into a
        // single row.
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

        userId = await linkProviderToUser(provider, providerAccountId, targetUserId);
      }

      // Auth.js passes `user` into the jwt callback only on initial sign-in;
      // overwriting `user.id` here is how we hand the database id to the JWT.
      user.id = userId;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      const tokenUserId = (token as { userId?: unknown }).userId;
      if (typeof tokenUserId === "string") {
        session.userId = tokenUserId;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Auth.js may invoke this callback with a relative same-origin path
      // (e.g. "/app?error=AccessDenied" or a relative `callbackUrl`).
      // Normalise to an absolute URL up front so the comparisons below
      // match both relative and absolute forms — without this, relative
      // values fell through to the final fallback and lost their error /
      // deep-link state.
      const normalizedUrl = url.startsWith("/") ? `${baseUrl}${url}` : url;

      // Auth.js error redirects (e.g. /app?error=AccessDenied,
      // /app?error=OAuthCallback) come through here when sign-in fails or
      // is cancelled. Identify them by the explicit ?error= query param
      // and pass through unchanged so AuthScreen renders the inline error.
      // The earlier broader rule (any /app URL) was too wide — the default
      // post-sign-in callbackUrl is also /app, which would bypass the
      // sp_token bridge entirely.
      if (
        normalizedUrl.startsWith(`${baseUrl}/app`) &&
        /[?&]error=/.test(normalizedUrl)
      ) {
        return normalizedUrl;
      }

      // Already in our sp_token bridge. Pass through.
      if (normalizedUrl.startsWith(`${baseUrl}/api/auth/oauth-complete`)) {
        return normalizedUrl;
      }

      // Successful sign-in (or any other same-origin destination): route
      // through the bridge so sp_token is minted before the user lands on
      // the SPA. Encode the original target as ?return= so the bridge can
      // honour deep-link/callbackUrl state after minting the cookie.
      if (normalizedUrl.startsWith(baseUrl)) {
        const target = normalizedUrl.slice(baseUrl.length) || "/app";
        return `${baseUrl}/api/auth/oauth-complete?return=${encodeURIComponent(target)}`;
      }

      // Off-origin URL (defensive). Drop and use the bridge default.
      return `${baseUrl}/api/auth/oauth-complete`;
    },
  },
});
