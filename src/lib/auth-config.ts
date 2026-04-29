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
  pages: {
    signIn: "/app",
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
          const username = await generateUniqueUsername(seed);

          const inserted = await db
            .insert(users)
            .values({ email, username })
            .onConflictDoNothing({ target: users.email })
            .returning({ id: users.id });

          if (inserted.length > 0) {
            targetUserId = inserted[0].id;
          } else {
            // Race: another callback created a user with this email
            // between our SELECT and INSERT. Look it up.
            const [racedRow] = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, email))
              .limit(1);
            if (!racedRow) {
              throw new Error("users insert raced and lookup returned no row");
            }
            targetUserId = racedRow.id;
          }
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
      // Auth.js error redirects (e.g. /app?error=AccessDenied,
      // /app?error=OAuthCallback) come through here when sign-in fails or
      // is cancelled. Pass them through unchanged so AuthScreen can render
      // the inline error — do NOT overwrite with the success bridge.
      if (url.startsWith(`${baseUrl}/app`)) return url;

      // Already in our sp_token bridge. Pass through.
      if (url.startsWith(`${baseUrl}/api/auth/oauth-complete`)) return url;

      // Same-origin success URL → route through the bridge to mint sp_token.
      // Anything off-origin (defensive) also goes through the bridge, which
      // ends on /app.
      return `${baseUrl}/api/auth/oauth-complete`;
    },
  },
});
