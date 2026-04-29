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
 *  surrounding loop appends numeric suffixes until a free slot is found. */
function sanitizeUsernameSeed(seed: string): string {
  const cleaned = seed.replace(/[^A-Za-z0-9_]/g, "");
  if (cleaned.length === 0) return "user";
  return cleaned.slice(0, MAX_USERNAME_LENGTH);
}

async function generateUniqueUsername(seed: string): Promise<string> {
  const base = sanitizeUsernameSeed(seed);
  const padded = base.length < MIN_USERNAME_LENGTH ? `${base}user`.slice(0, MAX_USERNAME_LENGTH) : base;

  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = attempt === 0 ? "" : `_${Math.random().toString(36).slice(2, 6)}`;
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

  // Last resort: random suffix from crypto.randomUUID() so the probability
  // of collision is negligible even under contention. Math.random() is not
  // cryptographically secure and would not give the same guarantee.
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  return `user_${random}`;
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
        const [emailMatch] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (emailMatch) {
          // Email match without an existing link → attach this provider
          // identity to the email-owning user.
          userId = emailMatch.id;
          await db.insert(oauthAccounts).values({
            userId,
            provider,
            providerAccountId,
          });
        } else {
          const seed =
            (typeof profile.name === "string" && profile.name) ||
            email.split("@")[0] ||
            "user";
          const username = await generateUniqueUsername(seed);

          const [created] = await db
            .insert(users)
            .values({ email, username })
            .returning({ id: users.id });
          userId = created.id;

          await db.insert(oauthAccounts).values({
            userId,
            provider,
            providerAccountId,
          });
        }
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
      // After OAuth completes, route through /api/auth/oauth-complete so the
      // server can mint our sp_token cookie before the user lands on /app.
      if (url.startsWith(`${baseUrl}/api/auth/oauth-complete`)) return url;
      return `${baseUrl}/api/auth/oauth-complete`;
    },
  },
});
